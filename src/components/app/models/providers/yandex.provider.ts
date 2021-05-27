import { createHash } from "crypto";
import { gretch } from "gretchen";
import { assertType } from "typescript-is";
import { parseArtists } from "../parser";
import { IPreview } from "../track.interface";
import Provider from "./provider.abstract";

export default class YandexProvider extends Provider<ITrackYandex> {
	protected baseURL = "https://api.music.yandex.net/";
	protected headers = {
		"User-Agent": "Yandex-Music-API",
		Authorization: `OAuth ${this.token}`
	};

	protected async *identify(source: string): AsyncGenerator<ITrackYandex> {
		let match;

		//From aggregator
		if (source.startsWith("aggr://yandex:")) {
			const audio = await this.call(`tracks/${source.slice(14)}`);
			const tracks = assertType<ISourceYandex>(audio).result;
			for (const track of tracks) yield track;

			return;
		}

		//From track url
		match = source.match(
			/(https?:\/\/)?music\.yandex\.ru\/album\/([0-9]+)\/track\/([0-9]+)/i
		);
		if (match) {
			const audios = await this.call(`tracks/${match[3]}`);
			const tracks = assertType<ISourceYandex>(audios).result;
			for (const track of tracks) yield track;

			return;
		}

		//From track album
		match = source.match(
			/(https?:\/\/)?music\.yandex\.ru\/album\/([0-9]+)/i
		);
		if (match) {
			const audios = await this.call(`albums/${match[2]}/with-tracks`);
			const tracks = assertType<IAlbumTracksYandex>(
				audios
			).result.volumes.flat();
			for (const track of tracks) yield track;

			return;
		}

		//From track artist
		match = source.match(
			/(https?:\/\/)?music\.yandex\.ru\/artist\/([0-9]+)/i
		);
		if (match) {
			let tracks;
			let page = 0;
			do {
				const audios = await this.call(`artists/${match[2]}/tracks`, {
					"page-size": 100,
					page: page++
				});
				tracks = assertType<IArtistTracksYandex>(audios).result.tracks;
				if (!tracks) return;
				for await (const track of tracks) yield track;
			} while (tracks);

			return;
		}

		//From playlist
		match = source.match(
			/(https?:\/\/)?music\.yandex\.ru\/users\/([a-z0-9_]+)\/playlists\/([0-9]+)/i
		);
		if (match) {
			const audios = await this.call(
				`users/${match[2]}/playlists/${match[3]}`
			);
			const tracks = assertType<IPlaylistYandex>(audios).result.tracks;
			if (!tracks) return;
			for await (const track of tracks) yield track.track;

			return;
		}
	}

	protected async *search(query: string): AsyncGenerator<ITrackYandex> {
		let tracks;
		let page = 0;
		do {
			const audios = await this.call("search", {
				type: "track",
				text: query,
				nococrrect: false,
				"page-size": 100,
				page: page++
			});
			tracks = assertType<IResponseYandex>(audios).result.tracks?.results;
			if (!tracks) return;
			for await (const track of tracks) yield track;
		} while (tracks);
	}

	protected async *artist(query: string): AsyncGenerator<ITrackYandex> {
		///IMPLEMENT!
	}

	protected async *album(query: string): AsyncGenerator<ITrackYandex> {
		///IMPLEMENT!
	}

	protected convert(track: ITrackYandex): IPreview {
		const converted = {
			title: track.title,
			artists: parseArtists(track.artists.map(x => x.name).join(", ")),
			album: track.albums[0]?.title || track.title,
			length: (track.durationMs || 0) / 1000,
			year: track.albums[0]?.year,
			cover: track.coverUri
				? "https://" +
				  track.coverUri.slice(0, track.coverUri.length - 2) +
				  "800x800"
				: undefined,
			url: null as any,
			sources: [`aggr://yandex:${track.id}`]
		};

		return {
			title: converted.title,
			artists: converted.artists,
			album: converted.album,
			cover: converted.cover,
			source: converted.sources[0],

			track: async () => {
				converted.url = await this.load(track.id);
				return converted;
			}
		};
	}

	protected validate(track: ITrackYandex): boolean {
		if (!track.durationMs) return false;
		if (track.durationMs > 1200 * 1000) return false;
		return true;
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
		const sign = createHash("md5").update(trackUrl).digest("hex");

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

interface IAlbumTracksYandex {
	result: { volumes: ITrackYandex[][] };
}

interface IArtistTracksYandex {
	result: { tracks?: ITrackYandex[] };
}

interface IPlaylistYandex {
	result: { tracks: { track: ITrackYandex }[] };
}

interface ISourceYandex {
	result: ITrackYandex[];
}

interface IResponseYandex {
	result: { tracks?: { results: ITrackYandex[] } };
}

interface ITrackYandex {
	id: number | string;
	albums: IAlbumYandex[];
	coverUri?: string;
	durationMs?: number;
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
