import { createHash } from "crypto";
import { gretch } from "gretchen";
import { assertType } from "typescript-is";
import { parseArtists } from "../parser";
import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";

export default class YandexProvider extends Provider<ITrackYandex> {
	protected baseURL = "https://api.music.yandex.net/";
	protected headers = {
		"User-Agent": "Yandex-Music-API",
		Authorization: `OAuth ${this.token}`
	};

	protected async identify(source: string): Promise<ITrackYandex[]> {
		//From aggregator
		if (source.startsWith("aggr://yandex:")) {
			const audio = await this.call(`tracks/${source.slice(14)}`);
			return assertType<ISourceYandex>(audio).result;
		}

		return [];
	}

	protected async convert(track: ITrackYandex): Promise<ITrack> {
		const converted = {
			title: track.title,
			artists: parseArtists(track.artists.map(x => x.name).join(", ")),
			album: track.albums[0].title,
			length: track.durationMs / 1000,
			year: track.albums[0].year,
			cover:
				"https://" +
				track.coverUri.slice(0, track.coverUri.length - 2) +
				"800x800",
			url: null as any,
			sources: [`aggr://yandex:${track.id}`]
		};

		converted.url = await this.load(track.id);
		return converted;
	}

	protected async search(
		query: string,
		count = 1,
		offset = 0
	): Promise<ITrackYandex[]> {
		const perPage = 20;
		const data = await this.call("search", {
			type: "track",
			text: query,
			page: Math.floor(offset / perPage),
			nococrrect: false
		});

		const tracks = assertType<IResponseYandex>(
			data
		).result.tracks.results.slice(offset % perPage, count);

		const onPage = perPage - (offset % perPage);
		if (count > onPage) {
			tracks.push(
				...(await this.search(query, count - onPage, offset + onPage))
			);
		}

		return tracks;
	}

	private async load(id: number | string): Promise<string> {
		const load = await this.call(`tracks/${id}/download-info`);

		const url =
			assertType<ILoadYandex>(load).result[0].downloadInfoUrl +
			"&format=json";

		const { error, data } = await gretch(url).json();
		if (error) throw error;
		const info = assertType<IInfoYandex>(data);

		const trackUrl = `XGRlBW9FXlekgbPrRHuSiA${info.path.substr(1)}${
			info.s
		}`;
		const sign = createHash("md5")
			.update(trackUrl)
			.digest("hex");

		return `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
	}
}

interface IInfoYandex {
	path: string;
	host: string;
	s: string;
	ts: string;
}

interface ILoadYandex {
	result: { downloadInfoUrl: string }[];
}

interface ISourceYandex {
	result: [ITrackYandex];
}

interface IResponseYandex {
	result: { tracks: { results: ITrackYandex[] } };
}

interface ITrackYandex {
	id: number | string;
	albums: IAlbumYandex[];
	coverUri: string;
	durationMs: number;
	title: string;
	artists: IArtistYandex[];
}

interface IAlbumYandex {
	year?: number;
	title: string;
}

interface IArtistYandex {
	name: string;
}
