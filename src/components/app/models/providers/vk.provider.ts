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

	private async convert(track: ITrackVK): Promise<ITrack> {
		return {
			title: track.title.replace(/(?<=\(([^)]+)\))\s+\(\1\)/g, ""),
			artists: parseArtists(track.artist),
			album: track.album?.title || track.title,
			length: track.duration,
			year: new Date(track.date * 1000).getFullYear(),
			cover: track.album?.thumb?.photo_1200,
			url: track.url,
			sources: [`aggr://vk:${track.owner_id}_${track.id}`]
		};
	}

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

		for (const track of tracks) {
			if (!track.url) continue;
			yield this.convert(track);
		}
	}

	public async *desource(source: string): AsyncGenerator<ITrack> {
		const handle = /(https?:\/\/)?vk\.com\/audio(-?[0-9]+_[0-9]+)/i;
		const match = source.match(handle);

		if (!match && !source.startsWith("aggr://")) return;
		source = source.replace("aggr://", "");
		if (!match && !source.startsWith("vk:")) return;
		source = source.replace("vk:", "");
		if (match) source = match[2];

		const { error, data } = await this.call("audio.getById", {
			audios: [source]
		});

		if (error) throw error;
		const tracks = assertType<ISourceVK>(data).response;

		for (const track of tracks) {
			if (!track.url) continue;
			yield this.convert(track);
		}
	}
}

interface ISourceVK {
	response: ITrackVK[];
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
