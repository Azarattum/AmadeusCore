import { is } from "typescript-is";
import { ITrackInfo, stringify } from "../track.interface";
import Recommender from "./recommender.abstract";

/**
 * Yandex track recommender
 */
export default class YandexRecommender extends Recommender {
	protected baseURL = "https://api.music.yandex.net/";
	protected headers = {
		"User-Agent": "Yandex-Music-API",
		Authorization: `OAuth ${this.token}`
	};

	protected async assemble(
		source: ITrackInfo,
		count: number
	): Promise<string[]> {
		//Search for the track
		const response = (await this.call("search", {
			type: "track",
			text: stringify(source),
			nococrrect: true,
			"page-size": 1,
			page: 0
		})) as any;
		const track = +response?.result?.tracks?.results?.[0]?.id;
		if (!track) return [];

		//Find similar
		return (await this.getSimilarTracks(track)).slice(0, count);
	}

	private async getSimilarTracks(id: number): Promise<string[]> {
		const result = (await this.call(
			`tracks/${id}/similar`
		)) as ISimilarTracks;

		if (!is<ISimilarTracks>(result)) return [];
		const similar = result.result.similarTracks;

		return similar.map(x => `aggr://yandex:${x.id}`);
	}
}

interface ISimilarTracks {
	result: {
		similarTracks: {
			id: string;
		}[];
	};
}
