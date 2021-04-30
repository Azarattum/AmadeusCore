import Ffmpeg from "fluent-ffmpeg";
import { PassThrough, Readable, Transform, TransformCallback } from "stream";
import { promisify } from "util";
import { ITrack } from "./track.interface";

export default class Restream {
	private meta: IMeta;
	private cover?: IInput;
	private image?: Buffer;
	private audio: IInput;

	public constructor(meta: IMeta, audio: IInput, cover?: IInput) {
		this.meta = meta;
		this.cover = cover;
		this.audio = audio;
	}

	public async load(): Promise<void> {
		if (!this.cover) return;
		const jpg = this.cover.mime === "image/jpeg";
		const stream = jpg
			? this.cover.stream
			: (Ffmpeg(this.cover.stream)
					.addOption(["-vf", "crop=ih:ih"])
					.format("mjpeg")
					.on("error", () => {})
					.pipe(undefined, { end: true }) as PassThrough);

		const buffers: Buffer[] = [];
		stream.on("data", buffer => buffers.push(buffer));

		await promisify(stream.on.bind(stream))("end");
		this.image = Buffer.concat(buffers);
	}

	public get source(): Readable {
		const type = this.audio.mime;
		if (type === "audio/mp4") return this.useMP4();
		if (type === "audio/mpeg") return this.useID3();

		//Covert to mp3
		this.audio.stream = Ffmpeg(this.audio.stream)
			.noVideo()
			.format("mp3")
			.on("error", () => {})
			.pipe() as Readable;

		return this.useID3();
	}

	public get filename(): string {
		const type = this.audio.mime === "audio/mpeg" ? "mp3" : "m4a";
		let name = !this.meta.artists
			? `${this.meta.title}.${type}`
			: `${this.meta.artists.join(", ")} - ${this.meta.title}.${type}`;

		name = name.replace(/[\\/:*?"<>|]/g, "");
		return name;
	}

	private useMP4(): Readable {
		return this.audio.stream.pipe(this.mp4Transform);
	}

	private useID3(): Readable {
		const streams = [this.id3Header, this.id3Tags];
		if (this.image) streams.push(this.id3Cover);
		streams.push(this.audio.stream);

		const pass = new PassThrough();
		const pipe = async () => {
			for await (const stream of streams) {
				stream.pipe(pass, { end: false });
				await promisify(stream.on.bind(stream))("end");
				stream.destroy();
			}
			pass.end();
		};
		pipe();

		return pass;
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

	public static async fromUrl(
		meta: IMeta,
		audioUrl: string,
		coverUrl?: string
	): Promise<Restream> {
		const audioLoading = fetch(audioUrl);
		const coverLoading = coverUrl ? fetch(coverUrl) : null;

		const [audio, cover] = await Promise.all([audioLoading, coverLoading]);

		const coverData = cover
			? {
					stream: (cover.body as unknown) as Readable,
					mime: cover.headers.get("content-type") || undefined
			  }
			: undefined;

		const audioData = {
			stream: (audio.body as unknown) as Readable,
			mime: audio.headers.get("content-type") || undefined
		};

		const restream = new Restream(meta, audioData, coverData);
		await restream.load();
		return restream;
	}

	public static async fromTrack(track: ITrack): Promise<Restream> {
		return this.fromUrl(track, track.url, track.cover);
	}

	private mp4Process(box: Buffer): Buffer {
		const sections: Record<string, [number, number]> = {};

		let offset = 8;
		const size = box.readUInt32BE();

		let leftovers = Buffer.from([]);
		if (size < box.byteLength) {
			leftovers = box.slice(size);
			box = box.slice(0, size);
		}

		while (offset < size) {
			const size = box.readUInt32BE(offset);
			const name = box.slice(offset + 4, offset + 8).toString();
			sections[name] = [offset, offset + size];
			offset += size;
		}

		if ("udta" in sections) {
			box = Buffer.concat([
				box.slice(0, sections["udta"][0]),
				box.slice(sections["udta"][1])
			]);
		}

		box = Buffer.concat([box, this.mp4Tags]);
		box.writeInt32BE(box.length);
		return Buffer.concat([box, leftovers]);
	}

	private get mp4Transform(): Transform {
		const moov = new Uint8Array([0x6d, 0x6f, 0x6f, 0x76]);

		let state = TransformState.SearchingMoov;
		let size: number;
		let offset: number;
		let box: Buffer;

		const stream = new Transform({
			transform: async (
				chunk: Buffer,
				encoding: string,
				callback: TransformCallback
			) => {
				switch (state) {
					case TransformState.SearchingMoov: {
						const index = chunk.indexOf(moov);
						if (index >= 4) {
							size = chunk.readUInt32BE(index - 4);
							const start = index - 4;
							const length = chunk.length - start;

							box = Buffer.alloc(Math.max(length, size));
							chunk.copy(box, offset, start, chunk.length);

							size -= Math.min(size, length);
							offset = length;
							state++;

							callback(null, chunk.slice(0, index - 4));
						} else {
							callback(null, chunk);
						}

						break;
					}
					case TransformState.FillingBox: {
						const length = Math.min(chunk.length, size);
						if (length > 0) chunk.copy(box, offset, 0, length);
						if (chunk.length >= size) {
							callback(
								null,
								Buffer.concat([
									this.mp4Process(box),
									chunk.slice(size)
								])
							);
							box = Buffer.alloc(0);
							state++;
						} else {
							callback(null, Buffer.from([]));
						}

						size -= length;
						offset += length;

						break;
					}
					case TransformState.PassingThrough: {
						callback(null, chunk);
						break;
					}
				}
			}
		});

		return stream;
	}

	private get mp4Tags(): Buffer {
		const buffers: Buffer[] = [];

		for (const tag in this.meta) {
			if (!(tag in MP4)) continue;
			let value = this.meta[tag as keyof IMeta];
			if (!value) continue;
			if (Array.isArray(value)) value = value.join(", ");
			if (typeof value === "number") value = value.toString();

			const data = Buffer.from(value, "utf-8");
			const size = 4 * 4 + 8 + data.byteLength;

			const sizeBuffer = Buffer.alloc(4);
			sizeBuffer.writeInt32BE(size);
			buffers.push(sizeBuffer);

			buffers.push(Buffer.from(MP4[tag as keyof typeof MP4], "ascii"));

			const dataBuffer = Buffer.alloc(4);
			dataBuffer.writeInt32BE(size - 8);
			buffers.push(dataBuffer);

			buffers.push(Buffer.from("data"));
			buffers.push(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]));
			buffers.push(data);
		}

		if (this.cover) buffers.push(this.mp4Cover);

		const header = Buffer.from("    udta    meta");
		const hldt = Buffer.from(
			"\0\0\0\0\0\0\0\x21hdlr\0\0\0\0\0\0\0\0mdirappl\0\0\0\0\0\0\0\0\0"
		);
		const ilst = Buffer.from("    ilst");

		let result = Buffer.concat([ilst, ...buffers]);
		result.writeInt32BE(result.length);
		result = Buffer.concat([header, hldt, result]);
		result.writeInt32BE(result.length);
		result.writeInt32BE(result.length - 8, 8);

		return result;
	}

	private get mp4Cover(): Buffer {
		if (!this.image) return Buffer.from([]);

		let buffers = [];
		const size = 4 * 4 + 8 + this.image.byteLength;

		const sizeBuffer = Buffer.alloc(4);
		sizeBuffer.writeInt32BE(size);
		buffers.push(sizeBuffer);

		buffers.push(Buffer.from(MP4.picture, "ascii"));

		const dataBuffer = Buffer.alloc(4);
		dataBuffer.writeInt32BE(size - 8);
		buffers.push(dataBuffer);

		buffers.push(Buffer.from("data"));
		buffers.push(Buffer.from([0, 0, 0, 0xe, 0, 0, 0, 0]));
		buffers.push(this.image);

		const result = Buffer.concat(buffers);
		buffers = [];
		delete this.image;

		return result;
	}

	private get id3Header(): Readable {
		const buffers = [
			Buffer.from("ID3"),
			Buffer.from([3, 0, 0]),
			this.toSyncBuffer(this.id3Length)
		];

		return Readable.from(buffers);
	}

	private get id3Length(): number {
		const tag = 4;
		const size = 4;
		const flags = 2;
		const encoding = 3;

		let length = 0;
		for (const name in this.meta) {
			if (!(name in ID3)) continue;
			let item = this.meta[name as keyof IMeta];
			if (!item) continue;
			if (Array.isArray(item)) item = item.join(", ");
			if (typeof item === "number") item = item.toString();

			length += tag + size + flags + encoding;
			length += Buffer.from(item, "ucs-2").length;
		}

		if (this.image) {
			length += tag + size + flags;
			length += 8 + "image/jpeg".length + this.image.byteLength; //Image & header
		}

		return length;
	}

	private get id3Tags(): Readable {
		const buffers: Buffer[] = [];

		for (const tag in this.meta) {
			if (!(tag in ID3)) continue;
			let value = this.meta[tag as keyof IMeta];
			if (!value) continue;
			if (Array.isArray(value)) value = value.join(", ");
			if (typeof value === "number") value = value.toString();

			const bytes = Buffer.from(value, "ucs-2");
			const buffer = Buffer.alloc(4);
			buffer.writeInt32BE(Buffer.byteLength(bytes) + 3);

			buffers.push(Buffer.from(ID3[tag as keyof typeof ID3]));
			buffers.push(buffer);
			buffers.push(Buffer.from([0, 0, 1]));
			buffers.push(Buffer.from([0xff, 0xfe]));
			buffers.push(bytes);
		}

		return Readable.from(buffers);
	}

	private get id3Cover(): Readable {
		const buffers: Buffer[] = [];

		if (!this.image) return Readable.from([]);
		const buffer = Buffer.alloc(4);
		buffer.writeInt32BE(this.image.byteLength + "image/jpeg".length + 8);

		buffers.push(Buffer.from(ID3.picture));
		buffers.push(buffer);
		buffers.push(Buffer.from([0, 0]));

		buffers.push(Buffer.from([0]));
		buffers.push(Buffer.from("image/jpeg"));
		buffers.push(Buffer.from([0, 3]));
		buffers.push(Buffer.from("JFIF"));
		buffers.push(Buffer.from([0]));

		buffers.push(this.image);

		return Readable.from(buffers);
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
	stream: Readable;
	mime?: string;
}

enum TransformState {
	SearchingMoov,
	FillingBox,
	PassingThrough
}

enum ID3 {
	title = "TIT2",
	artists = "TPE1",
	album = "TALB",
	length = "TLEN",
	year = "TYER",
	picture = "APIC"
}

enum MP4 {
	title = "\xA9nam",
	artists = "\xA9ART",
	album = "\xA9alb",
	year = "\xA9day",
	picture = "covr"
}
