import { Playlist } from "@prisma/client";
import { shuffle } from "../../../common/utils.class";
import Recommender, { TrackSource } from "./recommender.abstract";

/**
 * Recommends tracks based on the last 100 songs weighted by normal destribution
 */
export default class SimilarRecommender extends Recommender {
	public async get(
		source: TrackSource,
		playlist: Playlist
	): Promise<string[]> {
		const tracks = this.normalPick(await source(100), 20);
		const results: string[] = [];

		for (const track of tracks) {
			const similars = await this.getSimilar(track, 200);
			results.push(...this.normalPick(similars, 15));
			if (results.length > 100) break;
		}

		return shuffle(results.slice(0, 100));
	}
}
