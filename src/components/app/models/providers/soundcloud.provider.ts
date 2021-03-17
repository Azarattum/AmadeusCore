import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";
import fetch from "node-fetch";

export default class SoundCloudProvider extends Provider {
	protected baseURL = "https://api-v2.soundcloud.com/";
	protected headers = {
		"User-Agent":
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36"
	};
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

	private async load(
		track: ITrackSoundCloud,
		cover: string | null
	): Promise<[string | null, string | null]> {
		if (cover) {
			const alt = cover.replace("t500x500", "original");
			cover = (
				await fetch(alt).catch(() => {
					return { ok: false };
				})
			).ok
				? alt
				: cover;
		}

		const codings = track.media.transcodings;
		const url = codings
			.filter(x => x.format.protocol == "progressive")?.[0]
			?.url?.replace(this.baseURL, "");
		if (!url) return [null, cover];

		const reponse = await this.call(url);
		const json = await reponse.json();

		if (json.url.includes("preview")) return [null, cover];
		return [json.url || null, cover];
	}

	public async get(query: string, count = 1): Promise<ITrack[]> {
		const joins = /,|ft.|feat.|&|\+|\/|featuring|med|\||\band\b/;
		const tracks = await this.search(query, count);

		const metas = tracks.map(x => {
			const { title, album, artists, year } = this.parse(x.title);

			const cover = (x.artwork_url || x.user.avatar_url).replace(
				"large.jpg",
				"t500x500.jpg"
			);
			const media = x.media.transcodings
				.filter(x => x.format.protocol == "progressive")?.[0]
				?.url?.replace(this.baseURL, "");

			return {
				title: title,
				artists: [
					...new Set([
						...(x.publisher_metadata?.artist
							?.split(joins)
							?.map(x => x.trim()) || !artists.length
							? [x.user.full_name || x.user.username]
							: []),
						...artists
					])
				],
				album: x.publisher_metadata?.album_title || album,
				length: x.full_duration / 1000,
				year:
					year ||
					new Date(x.release_date || x.created_at).getFullYear(),
				cover: cover.includes("default_avatar") ? null : cover,
				url: null,
				sources: [`aggr://soundcloud:${media}`]
			};
		}) as ITrack[];

		await this.update(
			tracks.map((x, i) => [x, metas[i].cover]),
			this.load,
			(x, i) => {
				metas[i].url = x[0];
				metas[i].cover = x[1];
			}
		);

		return metas.filter(x => x.url);
	}

	public async desource(source: string): Promise<string | null> {
		if (!source.startsWith("aggr://")) return null;
		source = source.replace("aggr://", "");
		if (!source.startsWith("soundcloud:")) return null;
		source = source.replace("soundcloud:", "");

		const json = await (await this.call(source)).json();
		return json?.url || null;
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
