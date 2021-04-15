import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";
import ytsr, { ContinueResult } from "ytsr";
import ytdl from "ytdl-core";
import parse from "../parser";
import { is } from "typescript-is";
import ytpl from "ytpl";

export default class YouTubeProvider extends Provider<ITrackYouTube> {
	public async *identify(source: string): AsyncGenerator<ITrackYouTube> {
		//From aggregator
		if (source.startsWith("aggr://youtube:")) source = source.slice(15);

		//Video url
		try {
			const info = await ytdl.getBasicInfo(source);
			const details = info.player_response.videoDetails;
			const thumb = details.thumbnail.thumbnails.reduce(function(a, b) {
				return a.height > b.height ? a : b;
			});

			const track: ITrackYouTube = {
				id: details.videoId,
				title: details.title,
				author: { name: details.author },
				bestThumbnail: thumb,
				duration: details.lengthSeconds
			};

			yield track;
			return;
		} catch {
			//Not video
		}

		//Playlist/Channel url
		try {
			let playlist = (await ytpl(source)) as ytpl.ContinueResult;
			const tracks = playlist.items;

			for await (const track of tracks) {
				if (is<ITrackYouTube>(track)) yield track;
			}

			while (playlist.continuation) {
				playlist = await ytpl.continueReq(playlist.continuation);
				for await (const track of playlist.items) {
					if (is<ITrackYouTube>(track)) yield track;
				}
			}
		} catch {
			//Not playlist or channel
		}
	}

	protected async *search(query: string): AsyncGenerator<ITrackYouTube> {
		let response = (await ytsr(query, { pages: 1 })) as ContinueResult;
		const tracks = response.items;

		for await (const track of tracks) {
			if (track.type !== "video") continue;
			if (is<ITrackYouTube>(track)) yield track;
		}

		while (response.continuation) {
			response = await ytsr.continueReq(response.continuation);
			for await (const track of response.items) {
				if (track.type !== "video") continue;
				if (is<ITrackYouTube>(track)) yield track;
			}
		}
	}

	protected async convert(track: ITrackYouTube): Promise<ITrack> {
		const author = track.author
			? [track.author.name.replace(/ - Topic$/, "")]
			: [];
		const { title, artists, year, album } = parse(track.title);

		const converted = {
			title: title,
			artists: artists.length ? artists : author,
			album: album,
			length: 0,
			year: year,
			cover: track?.bestThumbnail?.url || undefined,
			url: null as any,
			sources: [`aggr://youtube:${track.id}`]
		};

		const [url, cover, length, date] = await this.load(track.id);

		converted.url = url;
		converted.cover = cover || converted.cover;
		converted.length = length;
		converted.year = converted.year || date;

		return converted;
	}

	protected validate(track: ITrackYouTube): boolean {
		const length = +track.duration
			.split(":")
			.reduce((acc, time) => 60 * +acc + +time + "");

		if (length > 1200) return false;
		return true;
	}

	private async load(id: string): Promise<[string, string, number, number?]> {
		const info = await ytdl.getInfo(id);
		const player = info.player_response;

		const audio = ytdl.filterFormats(info.formats, "audioonly");

		let format;
		try {
			format = ytdl.chooseFormat(audio, {
				quality: "highestaudio",
				filter: x => x.audioCodec?.startsWith("mp4a") || false
			});
		} catch {
			format = ytdl.chooseFormat(audio, {
				quality: "highestaudio",
				filter: x => x.audioCodec?.startsWith("opus") || false
			});
		}

		const thumb = info.videoDetails.thumbnails.reduce(function(a, b) {
			return a.height > b.height ? a : b;
		});
		const length = +(format.approxDurationMs || 0) / 1000;
		const year =
			new Date(
				player.microformat.playerMicroformatRenderer.uploadDate
			).getFullYear() || undefined;

		return [format.url, thumb.url, length, year];
	}
}

interface ITrackYouTube {
	id: string;
	title: string;
	duration: string;
	author?: { name: string };
	bestThumbnail?: { url: string };
}
