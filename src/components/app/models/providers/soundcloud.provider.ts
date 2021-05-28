import { gretch } from "gretchen";
import { assertType, is } from "typescript-is";
import parse, { parseArtists } from "../parser";
import { IPreview } from "../track.interface";
import Provider from "./provider.abstract";

export default class SoundCloudProvider extends Provider<ITrackSoundCloud> {
	protected baseURL = "https://api-v2.soundcloud.com/";
	protected headers = {
		"User-Agent":
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36"
	};
	protected params = {
		client_id: this.token
	};

	protected async *identify(
		source: string
	): AsyncGenerator<ITrackSoundCloud> {
		//From aggregator
		if (source.startsWith("aggr://soundcloud:")) {
			const audio = await this.call(`tracks/${source.slice(18)}`);
			const track = assertType<ITrackSoundCloud>(audio);
			yield track;

			return;
		}

		//From url
		const match = source.match(/(https?:\/\/)?soundcloud\.com\/.+/i);
		if (!match) return;
		source = source.replace(/\/$/, "");

		try {
			const data = await this.call("resolve", {
				url: source
			});

			if (is<ITrackSoundCloud>(data)) {
				yield data;
			} else if (is<IArtistSoundCloud>(data)) {
				let tracks;
				let page = `users/${data.id}/tracks`;
				do {
					const audios = await this.call(page, { limit: 100 });
					tracks = assertType<ICollectionSoundCloud>(audios);
					if (!tracks) return;

					for await (const track of tracks.collection) {
						if (is<ITrackSoundCloud>(track)) yield track;
					}

					page = tracks.next_href?.replace(
						this.baseURL,
						""
					) as string;
				} while (page);
			} else if (is<IPlaylistSoundCloud>(data)) {
				for await (const track of data.tracks) {
					if (is<ITrackSoundCloud>(track)) yield track;
				}
			}
		} catch {
			//Not found
		}
	}

	protected async *search(query: string): AsyncGenerator<ITrackSoundCloud> {
		let tracks;
		let page = "search/tracks";
		do {
			const audios = await this.call(page, { q: query, limit: 100 });
			tracks = assertType<ICollectionSoundCloud>(audios);
			if (!tracks) return;

			for await (const track of tracks.collection) {
				if (is<ITrackSoundCloud>(track)) yield track;
			}

			page = tracks.next_href?.replace(this.baseURL, "") as string;
		} while (page);
	}

	protected async *artist(query: string): AsyncGenerator<ITrackSoundCloud> {
		//Not aplicable
	}

	protected async *album(query: string): AsyncGenerator<ITrackSoundCloud> {
		//Not aplicable
	}

	protected convert(track: ITrackSoundCloud): IPreview | null {
		const { title, album, artists, year } = parse(track.title);

		//Check media
		const media = track.media.transcodings
			.filter(x => x.format.protocol == "progressive")?.[0]
			?.url?.replace(this.baseURL, "");

		if (!media) return null;
		if (media.includes("preview")) return null;

		//Find artists
		artists.push(
			...parseArtists(track.publisher_metadata?.artist || undefined)
		);
		if (!artists.length)
			artists.push(track.user.full_name || track.user.username);

		//Find cover
		let cover = track.artwork_url || track.user.avatar_url || undefined;
		if (!cover || cover.includes("default_avatar")) cover = undefined;
		cover = cover?.replace("large.jpg", "t500x500.jpg");

		const converted = {
			title: title,
			artists: [...new Set(artists)],
			album: track.publisher_metadata?.album_title || album || title,
			length: track.full_duration / 1000,
			year:
				year ||
				new Date(track.release_date || track.created_at).getFullYear(),
			cover: cover,
			url: undefined as any,
			sources: [`aggr://soundcloud:${track.id}`]
		};

		return {
			title: converted.title,
			artists: converted.artists,
			album: converted.album,
			cover: converted.cover,
			source: converted.sources[0],

			track: async () => {
				const [url, image] = await this.load(media, cover);

				converted.cover = image;
				converted.url = url;

				return converted;
			}
		};
	}

	protected validate(track: ITrackSoundCloud): boolean {
		if (track.full_duration > 1200 * 1000) return false;
		return true;
	}

	private async load(
		media: string,
		cover?: string
	): Promise<[string, string?]> {
		if (cover) {
			const original = cover.replace("t500x500.jpg", "original.jpg");
			const { status } = await gretch(original).flush();
			if (status === 200) cover = original;
		}

		const data = await this.call(media);
		const url = assertType<{ url: string }>(data).url;

		return [url, cover];
	}
}

interface ICollectionSoundCloud {
	collection: (ITrackSoundCloud | Record<string, any>)[];
	next_href?: string | null;
}

interface ITrackSoundCloud {
	artwork_url?: string | null;
	created_at: string;
	full_duration: number;
	id: number;
	publisher_metadata?: IMetaSoundCloud | null;
	release_date?: string | null;
	title: string;
	media: { transcodings: ITranscodingsSoundCloud[] };
	user: IArtistSoundCloud;
}

interface IPlaylistSoundCloud {
	tracks: (ITrackSoundCloud | Record<string, any>)[];
}

interface IArtistSoundCloud {
	id: number;
	username: string;
	full_name?: string | null;
	avatar_url?: string | null;
}

interface ITranscodingsSoundCloud {
	url: string;
	format: { protocol: "hls" | "progressive" };
}

interface IMetaSoundCloud {
	artist?: string | null;
	album_title?: string | null;
}
