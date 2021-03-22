import Ffmpeg from "fluent-ffmpeg";
import fetch from "node-fetch";
import { PassThrough, Readable, Stream } from "stream";
import { ITrack } from "./track.interface";

export default class Restream extends PassThrough {
	private meta: IMeta;
	private cover?: IInput;
	private audio: IInput;
	private mime: string;

	public constructor(meta: IMeta, audio: IInput, cover?: IInput) {
		super();
		this.meta = meta;
		this.cover = cover;
		this.audio = audio;
		this.mime = cover?.mime || "image/jpeg";

		this.once("resume", () => {
			this.writeHeader();
			this.writeTags();
			if (this.cover) {
				this.writeCoverHeader();
				this.cover.stream.pipe(this, { end: false });
				this.cover.stream.on("end", async () => {
					this.writeAudio(this.audio);
				});
			} else {
				this.writeAudio(this.audio);
			}
		});
	}

	public static async fromUrl(
		meta: IMeta,
		audioUrl: string,
		coverUrl?: string
	): Promise<Restream> {
		const audioLoading = fetch(audioUrl);
		const coverLoading = coverUrl ? fetch(coverUrl) : null;

		const [audio, cover] = await Promise.all([audioLoading, coverLoading]);
		const audioMime = audio.headers.get("content-type") || "audio/unknown";
		const audioSize = +(audio.headers.get("content-length") || 0) || null;

		let coverData;
		if (cover) {
			let stream = cover.body;
			const mime = cover.headers.get("content-type") || "image/jpeg";
			let size = +(cover?.headers.get("content-length") || 0);

			if (!size) {
				const buffer = await cover.buffer();
				size = buffer.byteLength;
				stream = Readable.from(buffer);
			}

			coverData = { stream, mime, size };
		}

		return new Restream(
			meta,
			{
				stream: audio.body,
				mime: audioMime,
				size: audioSize
			},
			coverData
		);
	}

	public static async fromTrack(track: ITrack): Promise<Restream> {
		return this.fromUrl(track, track.url, track.cover);
	}

	private get metaLength(): number {
		const tag = 4;
		const size = 4;
		const flags = 2;
		const encoding = 3;

		let length = 0;
		for (const name in this.meta) {
			if (!(name in Tag)) continue;
			let item = this.meta[name as keyof IMeta];
			if (!item) continue;
			if (Array.isArray(item)) item = item.join(", ");
			if (typeof item === "number") item = item.toString();

			length += tag + size + flags + encoding;
			length += Buffer.from(item, "ucs-2").length;
		}

		if (this.cover && this.cover.size) {
			length += tag + size + flags;
			length += 8 + this.mime.length + (this.cover?.size || 0); //Image & header
		}

		return length;
	}

	private toSyncBuffer(int: number): Buffer {
		let mask = 0x7f;
		let synchsafed = 0;

		while ((mask ^ 0x7fffffff) !== 0) {
			synchsafed = int & ~mask;
			synchsafed <<= 1;
			synchsafed |= int & mask;
			mask = ((mask + 1) << 8) - 1;
			int = synchsafed;
		}

		const buffer = Buffer.alloc(4);
		buffer.writeInt32BE(synchsafed);
		return buffer;
	}

	private writeHeader(): void {
		this.write("ID3");
		this.write(new Uint8Array([3, 0, 0]));

		this.write(this.toSyncBuffer(this.metaLength));
	}

	private writeTags(): void {
		for (const tag in this.meta) {
			if (!(tag in Tag)) continue;
			let value = this.meta[tag as keyof IMeta];
			if (!value) continue;
			if (Array.isArray(value)) value = value.join(", ");
			if (typeof value === "number") value = value.toString();

			const bytes = Buffer.from(value, "ucs-2");
			const buffer = Buffer.alloc(4);
			buffer.writeInt32BE(Buffer.byteLength(bytes) + 3);

			this.write(Tag[tag as keyof typeof Tag]);
			this.write(buffer);
			this.write(new Uint8Array([0, 0, 1]));
			this.write(new Uint8Array([0xff, 0xfe]));
			this.write(bytes);
		}
	}

	private writeCoverHeader(): void {
		if (!this.cover || !this.cover.size) return;
		const buffer = Buffer.alloc(4);
		buffer.writeInt32BE(this.cover.size + this.mime.length + 8);

		this.write(Tag.picture);
		this.write(buffer);
		this.write(new Uint8Array([0, 0]));

		this.write(new Uint8Array([0]));
		this.write(this.mime);
		this.write(new Uint8Array([0, 3]));
		this.write("JFIF");
		this.write(new Uint8Array([0]));
	}

	private writeAudio(audio: IInput): any {
		let stream = audio.stream;
		if (audio.mime !== "audio/mpeg") {
			stream = Ffmpeg(audio.stream as Readable)
				.noVideo()
				.format("mp3")
				.pipe();
		}

		let total = 0;
		let previous = 0;
		stream.on("data", chunk => {
			this.write(chunk);

			if (!audio.size) return;
			total += chunk.length;
			const progress = total / audio.size;
			if (progress - previous > 0.1) {
				this.emit("progress", progress);
				previous = progress;
			}
		});

		stream.on("end", () => {
			if (this.emit("beforeEnd")) return;
			this.end();
		});
	}
}

interface IMeta {
	title?: string;
	artists?: string[];
	album?: string;
	length?: number;
	year?: number;
}

interface IInput {
	stream: Stream;
	size: number | null;
	mime: string | null;
}

enum Tag {
	title = "TIT2",
	artists = "TPE1",
	album = "TALB",
	length = "TLEN",
	year = "TYER",
	picture = "APIC"
}
