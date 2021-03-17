import fetch from "node-fetch";
import Ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { Promise as Meta } from "node-id3";
import { ITrack } from "./track.interface";

export default class Loader {
	public static async load(
		track: ITrack,
		progress: (percent: number) => void
	): Promise<Buffer> {
		if (!track.url) throw new Error("No URL specified!");

		const dataLoad = fetch(track.url).catch(e => {
			throw e;
		});

		const coverLoad = track.cover
			? fetch(track.cover).catch(() => undefined)
			: undefined;

		const [data, cover] = await Promise.all([dataLoad, coverLoad]);
		const type = data.headers.get("content-type");
		const length = +(data.headers.get("content-length") || 0);

		const buffers: any[] = [];
		const stream =
			type == "audio/webm"
				? Ffmpeg(Readable.from(data.body))
						.format("mp3")
						.noVideo()
						.on("error", () => {})
						.pipe()
				: Readable.from(data.body);

		//Track progress
		let loaded = 0;
		let prev = 0;
		stream.on("data", buffer => {
			if (loaded < 0) return;
			loaded += buffer.length;
			buffers.push(buffer);

			const percent = Math.round((loaded / length) * 100);
			if (percent - prev > 10) {
				progress(percent);
				prev = percent;
			}
		});

		//Catch errors
		stream.on("error", e => {
			throw e;
		});

		const meta = {
			title: track.title,
			artist: track.artists.join(", "),
			album: track.album,
			year: track.year?.toString(),
			length: track.length.toString(),
			APIC: cover ? await cover.buffer() : undefined
		};

		return new Promise(resolve => {
			stream.on("close", async () => {
				loaded = -1;
				const buffer = await Meta.update(meta, Buffer.concat(buffers));
				resolve(buffer);
			});
		});
	}
}
