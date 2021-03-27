import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";

export default class VKProvider extends Provider {
	protected baseURL = "https://api.vk.com/method/";
	protected headers = {
		"User-Agent":
			"VKAndroidApp/5.52-4543 (Android 5.1.1; SDK 22; x86_64; unknown Android SDK built for x86_64; en; 320x240)"
	};
	protected params = {
		v: "5.71",
		access_token: this.token
	};

	private async search(
		query: string,
		count = 1,
		offset = 0
	): Promise<ITrackVK[]> {
		const response = await this.call("audio.search", {
			q: query,
			count,
			offset
		});
		const json = await response.json();

		return json["response"]["items"] as ITrackVK[];
	}

	public async get(query: string, count = 1, offset = 0): Promise<ITrack[]> {
		const tracks = await this.search(query, count, offset);
		const joins = /,|ft.|feat.|&|\+|\/|featuring|med|\||\band\b/;

		const metas = tracks.map(x => {
			return {
				title: x.title.replace(/(?<=\(([^)]+)\))\s+\(\1\)/g, ""),
				artists: x.artist.split(joins).map(x => x?.trim()),
				album: x.album?.title || x.title,
				length: x.duration,
				year: new Date(x.date * 1000).getFullYear(),
				cover: x.album?.thumb?.photo_1200,
				url: x.url,
				sources: [`aggr://vk:${x.owner_id}_${x.id}`]
			};
		});

		return metas.filter(x => x.url);
	}

	public async desource(source: string): Promise<string | null> {
		if (!source.startsWith("aggr://")) return null;
		source = source.replace("aggr://", "");
		if (!source.startsWith("vk:")) return null;
		source = source.replace("vk:", "");

		const response = await this.call("audio.getById", { audios: [source] });
		const json = await response.json();

		return json?.["response"]?.[0]?.["url"] || null;
	}
}

interface ITrackVK {
	artist: string;
	id: number;
	owner_id: number;
	title: string;
	duration: number;
	access_key: string;
	is_licensed: boolean;
	url: string;
	date: number;
	is_hq: boolean;
	album?: IAlbumVK;
	track_genre_id: number;
	short_videos_allowed: boolean;
	stories_allowed: boolean;
	stories_cover_allowed: boolean;
}

interface IAlbumVK {
	id: number;
	title: string;
	owner_id: number;
	access_key: string;
	thumb: IThumbVK;
}

interface IThumbVK {
	width: number;
	height: number;
	photo_34: string;
	photo_68: string;
	photo_135: string;
	photo_270: string;
	photo_300: string;
	photo_600: string;
	photo_1200: string;
}
