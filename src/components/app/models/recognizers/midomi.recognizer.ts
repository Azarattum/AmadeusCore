import Ffmpeg from "fluent-ffmpeg";
import { gretch } from "gretchen";
import { Readable } from "stream";
import { is } from "typescript-is";
import { promisify } from "util";
import { gunzip } from "zlib";
import { wrn } from "../../../common/utils.class";
import Recognizer from "./recognizer.abstract";

export default class MidomiRecognizer extends Recognizer {
	protected baseURL = "wss://houndify.midomi.com/";

	private convert(stream: NodeJS.ReadableStream) {
		return Ffmpeg(Readable.from(stream))
			.addOption("-c speex")
			.format("ogg")
			.on("error", e => {
				e = e.toString().trim();
				if (e != "Error: Output stream closed") {
					wrn(`FFMpeg failed on aduio convertion!\n${e}`);
				}
			})
			.pipe();
	}

	public async detect(url: string): Promise<string | null> {
		const { response, status: code } = await gretch(url).flush();
		if (code !== 200) return null;
		if (!response.body) return null;
		const stream = this.convert(response.body);

		await this.connect();
		const check = await this.send({ version: "1.0" }, true);
		if (!is<ICheck>(check)) throw check;

		stream.on("data", (data: Buffer) => {
			this.send(data);
		});

		await promisify(stream.on.bind(stream))("end");

		const data = await this.send({ endOfAudio: true }, true);
		if (!(data instanceof Buffer)) return null;
		const text = ((await promisify(gunzip)(data)) as any).toString();
		const result = JSON.parse(text);

		if (!is<IResult>(result)) return null;
		const track = result.AllResults[0]?.NativeData.Tracks[0];
		if (!track) return null;
		return `${track.ArtistName} - ${track.TrackName}`;
	}
}

interface ICheck {
	status: "ok";
}

interface IResult {
	AllResults: {
		NativeData: {
			Tracks: {
				TrackName: string;
				ArtistName: string;
			}[];
		};
	}[];
}
