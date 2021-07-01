import { is } from "typescript-is";
import { ITrackInfo, stringify } from "../track.interface";
import Transcriber from "./transcriber.abstract";

/**
 * Yandex lyrics transcriber
 */
export default class YandexTranscriber extends Transcriber {
	protected baseURL = "https://api.music.yandex.net/";
	protected headers = {
		"User-Agent": "Yandex-Music-API",
		Authorization: `OAuth ${this.token}`
	};

	protected async assemble(source: ITrackInfo): Promise<string | null> {
		//Search for the track
		const response = (await this.call("search", {
			type: "track",
			text: stringify(source),
			nococrrect: true,
			"page-size": 1,
			page: 0
		})) as any;
		const track = +response?.result?.tracks?.results?.[0]?.id;
		if (!track) return null;

		return this.getLyrics(track);
	}

	private async getLyrics(id: number): Promise<string | null> {
		const result = (await this.call(
			`tracks/${id}/supplement`
		)) as ILyricsResult;

		if (!is<ILyricsResult>(result)) return null;

		return result.result.lyrics.fullLyrics;
	}
}

interface ILyricsResult {
	result: {
		lyrics: {
			fullLyrics: string;
		};
	};
}
