/* eslint-disable @typescript-eslint/camelcase */
import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";

export default class SoundCloudProvider extends Provider {
	protected baseURL = "https://api-v2.soundcloud.com/";
	protected params = {
		client_id: this.token
	};

	private async search(
		query: string,
		count = 1
	): Promise<ITrackSoundCloud[]> {
		const response = await this.call("search/tracks", {
			q: query,
			limit: count
		});
		const json = await response.json();

		return json["collection"] as ITrackSoundCloud[];
	}

	private async load(track: ITrackSoundCloud): Promise<string | null> {
		const codings = track.media.transcodings;
		const url = codings
			.filter(x => x.format.protocol == "progressive")?.[0]
			?.url?.replace(this.baseURL, "");
		if (!url) return null;

		const reponse = await this.call(url);
		const json = await reponse.json();

		if (json.url.includes("preview")) return null;
		return json.url || null;
	}

	private parseTitle(
		title: string,
		album: string
	): [string, string, string[]] {
		const joins = /,|&|\+|\//;
		let artist = "";

		if (title.includes(" - ")) {
			[album, title] = title.split(" - ");
		}
		if (title.includes("- ")) {
			[album, title] = title.split("- ");
		}
		if (title.includes(" | ")) {
			[album, title] = title.split(" | ");
		}
		if (title.includes(" ♫ ")) {
			[album, title] = title.split(" ♫ ");
		}
		if (album?.includes(" ♫ ")) {
			[album, title] = album.split(" ♫ ");
		}

		if (title.includes(" by ")) {
			[title, artist] = title.split(" by ");
		}
		if (title.includes(" By ")) {
			[title, artist] = title.split(" By ");
		}
		if (title.includes(" ft. ")) {
			[title, artist] = title.split(" ft. ");
		}
		if (title.includes(" feat. ")) {
			[title, artist] = title.split(" ft. ");
		}
		if (title.includes(" featuring ")) {
			[title, artist] = title.split(" featuring ");
		}
		if (title.includes(" med ")) {
			[title, artist] = title.split(" med ");
		}

		const artistRegex = /\((ft\.?|feat\.?|featuring|by|med)([^)]+?)\)/i;
		if (title.match(artistRegex)) {
			artist = title.match(artistRegex)?.[2] || artist;
			title = title.replace(artistRegex, "");
		}

		const artists = artist ? artist.split(joins).map(x => x.trim()) : [];

		return [title?.trim(), album?.trim() || title?.trim(), artists];
	}

	public async get(query: string, count = 1): Promise<ITrack[]> {
		const joins = /,|ft.|feat.|&|\+|\/|featuring|med|\|/;
		const tracks = await this.search(query, count);

		const metas = tracks.map(x => {
			const [title, album, artists] = this.parseTitle(
				x.title,
				x.publisher_metadata?.album_title
			);

			return {
				title: title,
				artists: [
					...new Set([
						...(x.publisher_metadata?.artist
							?.split(joins)
							?.map(x => x.trim()) || [
							x.user.full_name || x.user.username
						]),
						...artists
					])
				],
				album: album,
				length: x.full_duration / 1000,
				year: new Date(x.release_date || x.created_at).getFullYear(),
				cover: (x.artwork_url || x.user.avatar_url).replace(
					"large.jpg",
					"t500x500.jpg"
				),
				url: null
			};
		}) as ITrack[];

		const loads: Promise<any>[] = [];
		for (const i in tracks) {
			const promise = this.load(tracks[i]).then(x => {
				metas[i].url = x;
			});
			loads.push(promise);
		}

		await Promise.all(loads);

		return metas.filter(x => x.url);
	}
}

interface ITrackSoundCloud {
	artwork_url: string;
	caption?: any;
	commentable: boolean;
	comment_count: number;
	created_at: string;
	description?: any;
	downloadable: boolean;
	download_count: number;
	duration: number;
	full_duration: number;
	embeddable_by: string;
	genre: string;
	has_downloads_left: boolean;
	id: number;
	kind: string;
	label_name?: any;
	last_modified: string;
	license: string;
	likes_count: number;
	permalink: string;
	permalink_url: string;
	playback_count: number;
	public: boolean;
	publisher_metadata: IArtistSoundCloud;
	purchase_title?: any;
	purchase_url?: any;
	release_date: string;
	reposts_count: number;
	secret_token?: any;
	sharing: string;
	state: string;
	streamable: boolean;
	tag_list: string;
	title: string;
	track_format: string;
	uri: string;
	urn: string;
	user_id: number;
	visuals?: any;
	waveform_url: string;
	display_date: string;
	media: { transcodings: ITranscodingsSoundCloud[] };
	monetization_model: string;
	policy: string;
	user: any;
}

interface ITranscodingsSoundCloud {
	url: string;
	preset: string;
	duration: number;
	snipped: boolean;
	format: { protocol: "hls" | "progressive"; mime_type: string };
	quality: string;
}

interface IArtistSoundCloud {
	id: number;
	urn: string;
	artist: string;
	album_title: string;
	contains_music: boolean;
	upc_or_ean: string;
	isrc: string;
	explicit: boolean;
	p_line: string;
	p_line_for_display: string;
	c_line: string;
	c_line_for_display: string;
	release_title: string;
}
