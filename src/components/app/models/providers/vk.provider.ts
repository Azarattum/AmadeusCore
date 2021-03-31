import { assertType } from "typescript-is";
import { parseArtists } from "../parser";
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
		const { error, data } = await this.call("audio.search", {
			q: query,
			count,
			offset
		});

		if (error) throw error;
		return assertType<IResponseVK>(data).response.items;
	}

	public async *get(
		query: string,
		count = 1,
		offset = 0
	): AsyncGenerator<ITrack> {
		const tracks = await this.search(query, count, offset);

		for (const x of tracks) {
			if (!x.url) continue;
			yield {
				title: x.title.replace(/(?<=\(([^)]+)\))\s+\(\1\)/g, ""),
				artists: parseArtists(x.artist),
				album: x.album?.title || x.title,
				length: x.duration,
				year: new Date(x.date * 1000).getFullYear(),
				cover: x.album?.thumb?.photo_1200,
				url: x.url,
				sources: [`aggr://vk:${x.owner_id}_${x.id}`]
			};
		}
	}

	public async desource(source: string): Promise<string | null> {
		if (!source.startsWith("aggr://")) return null;
		source = source.replace("aggr://", "");
		if (!source.startsWith("vk:")) return null;
		source = source.replace("vk:", "");

		const { error, data } = await this.call("audio.getById", {
			audios: [source]
		});

		if (error) throw error;
		return assertType<ISourceVK>(data).response[0].url;
	}
}

interface ISourceVK {
	response: [{ url: string }];
}

interface IResponseVK {
	response: { items: ITrackVK[] };
}

interface ITrackVK {
	artist: string;
	id: number;
	owner_id: number;
	title: string;
	duration: number;
	url: string;
	date: number;
	album?: IAlbumVK;
}

interface IAlbumVK {
	title: string;
	thumb?: { photo_1200?: string };
}
