/* eslint-disable @typescript-eslint/camelcase */
import { createHash } from "crypto";
import fetch from "node-fetch";
import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";

export default class YandexProvider extends Provider {
	protected baseURL = "https://api.music.yandex.net/";
	protected headers = {
		"User-Agent": "Yandex-Music-API",
		Authorization: `OAuth ${this.token}`
	};

	private async search(
		query: string,
		count = 1,
		offset = 0
	): Promise<ITrackYandex[]> {
		const response = await this.call("search", {
			type: "track",
			text: query,
			page: offset,
			nococrrect: false
		});

		const json = await response.json();
		const tracks = json["result"]["tracks"]?.["results"].slice(0, count);
		if (!tracks) return [];
		if (count > 20) {
			tracks.push(...(await this.search(query, count - 20, offset + 1)));
		}

		return tracks;
	}

	private async load(id: number): Promise<string> {
		const response = await this.call(`tracks/${id}/download-info`);

		const url =
			(await response.json())["result"][0]["downloadInfoUrl"] +
			"&format=json";

		const info = await (await fetch(url)).json();
		const trackUrl = `XGRlBW9FXlekgbPrRHuSiA${info.path.substr(1)}${
			info.s
		}`;
		const sign = createHash("md5")
			.update(trackUrl)
			.digest("hex");

		return `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
	}

	public async get(query: string, count = 1): Promise<ITrack[]> {
		const tracks = await this.search(query, count);

		const metas = tracks.map(x => {
			return {
				title: x.title,
				artists: x.artists.map(x => x.name),
				album: x.albums[0].title,
				length: x.durationMs / 1000,
				year: x.albums[0].year,
				cover:
					"https://" +
						x.coverUri.slice(0, x.coverUri.length - 2) +
						"800x800" || null,
				url: null
			};
		}) as ITrack[];

		await this.update(
			tracks.map(x => [x.id]),
			this.load,
			(x, i) => {
				metas[i].url = x;
			}
		);

		return metas.filter(x => x.url);
	}
}

interface IAlbumYandex {
	id: number;
	storageDir: string;
	originalReleaseYear: number;
	year: number;
	artists: any[];
	coverUri: string;
	trackCount: number;
	likesCount: number;
	genre: string;
	available: boolean;
	contentWarning: string;
	availableForPremiumUsers: boolean;
	title: string;
	availableRegions: any[];
	labels: any[];
	trackPosition: any[];
}

interface IArtistYandex {
	id: number;
	name: string;
	cover: any[];
	composer: boolean;
	various: boolean;
	decomposed: any[];
}

interface ITrackYandex {
	id: number;
	available: boolean;
	availableAsRbt: boolean;
	availableForPremiumUsers: boolean;
	lyricsAvailable: boolean;
	rememberPosition: boolean;
	albums: IAlbumYandex[];
	coverUri: string;
	type: string;
	durationMs: number;
	explicit: boolean;
	title: string;
	artists: IArtistYandex[];
	regions: string[];
}
