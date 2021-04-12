import { is } from "typescript-is";
import { shuffle } from "../../../common/utils.class";
import Recommender, { ITrackInfo } from "./recommender.abstract";

/**
 * Last FM track recommender
 */
export default class LastFMRecommender extends Recommender {
	protected baseURL = "https://ws.audioscrobbler.com/2.0/";
	protected params = {
		api_key: this.token,
		format: "json",
		autocorrect: "1"
	};

	public async assemble(source: ITrackInfo[]): Promise<string[]> {
		const tracks = this.normalPick(source);
		const results: string[] = [];

		for (const track of tracks) {
			const similars = await this.getSimilarTracks(track, 200);
			results.push(...this.normalPick(similars, 15));
			if (results.length > 100) break;
		}

		return shuffle(results.slice(0, 100));
	}

	private async getSimilarTracks(
		track: ITrackInfo,
		limit?: number
	): Promise<string[]> {
		const result = await this.call("", {
			method: "track.getsimilar",
			track: track.title,
			artist: track.artists.join(", "),
			limit
		});
		if (!is<ISimilarTracks>(result)) return [];
		const tracks = result.similartracks.track;

		return tracks.map(x => {
			return [x.artist?.name, x.name].filter(x => x).join(" - ");
		});
	}

	private async getSimilarArtists(
		artist: string,
		limit?: number
	): Promise<string[]> {
		const result = await this.call("", {
			method: "artist.getsimilar",
			artist: artist,
			limit
		});
		if (!is<ISimilarArtists>(result)) return [];
		const artists = result.similarartists.artist;

		return artists.map(x => x.name);
	}

	private async getTopTracks(
		artist: string,
		limit?: number
	): Promise<string[]> {
		const result = await this.call("", {
			method: "artist.gettoptracks",
			artist: artist,
			limit
		});
		if (!is<ITopTracks>(result)) return [];
		const tracks = result.toptracks.track;

		return tracks.map(x => {
			return [x.artist?.name, x.name].filter(x => x).join(" - ");
		});
	}
}

interface ISimilarTracks {
	similartracks: {
		track: { artist?: { name: string } | null; name: string }[];
	};
}

interface ITopTracks {
	toptracks: {
		track: { artist?: { name: string } | null; name: string }[];
	};
}

interface ISimilarArtists {
	similarartists: {
		artist: { name: string }[];
	};
}
