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
		const perPage = 20;
		const response = await this.call("search", {
			type: "track",
			text: query,
			page: Math.floor(offset / perPage),
			nococrrect: false
		});

		const json = await response.json();
		const tracks = json["result"]["tracks"]?.["results"].slice(
			offset % perPage,
			count
		);

		if (!tracks) return [];
		const onPage = perPage - (offset % perPage);
		if (count > onPage) {
			tracks.push(
				...(await this.search(query, count - onPage, offset + onPage))
			);
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

	public async get(query: string, count = 1, offset = 0): Promise<ITrack[]> {
		const tracks = await this.search(query, count, offset);
		const joins = /,|ft.|feat.|&|\+|\/|featuring|med|\||\band\b/;

		const metas = tracks.map(x => {
			const artists: string[] = [];
			x.artists.forEach(x =>
				artists.push(...x.name.split(joins).map(x => x?.trim()))
			);

			return {
				title: x.title,
				artists: [...new Set(artists)],
				album: x.albums[0].title,
				length: x.durationMs / 1000,
				year: x.albums[0].year,
				cover:
					"https://" +
					x.coverUri.slice(0, x.coverUri.length - 2) +
					"800x800",
				url: null as any,
				sources: [`aggr://yandex:${x.id}`]
			};
		});

		await this.update(
			tracks.map(x => [x.id]),
			this.load,
			(x, i) => {
				metas[i].url = x as any;
			}
		);

		return metas.filter(x => x.url);
	}

	public async desource(source: string): Promise<string | null> {
		if (!source.startsWith("aggr://")) return null;
		source = source.replace("aggr://", "");
		if (!source.startsWith("yandex:")) return null;
		source = source.replace("yandex:", "");
		if (!+source) return null;
		const id = +source;

		return this.load(id) || null;
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
