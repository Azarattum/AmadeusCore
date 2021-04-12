import Controller from "../../common/controller.abstract";
import Provider from "../models/providers/provider.abstract";
import { compareTwoStrings } from "string-similarity";
import { ITrack } from "../models/track.interface";
import { mergeGenerators, nFirst, shuffle } from "../../common/utils.class";
import Recommender, {
	ITrackInfo
} from "../models/recommenders/recommender.abstract";

/**
 * Aggregates track data from all Amadeus' providers
 */
export default class Aggregator extends Controller() {
	private providers: Provider[] = [];
	private recommenders: Recommender[] = [];

	public initialize(
		providers: Provider[] = [],
		recommenders: Recommender[] = []
	): void {
		this.providers = providers;
		this.recommenders = recommenders;
	}

	public async *get(query: string): AsyncGenerator<ITrack> {
		//Return from desource
		const source = this.desource([query]);
		let fromSource = false;
		for await (const track of source) {
			fromSource = true;
			yield track;
		}
		if (fromSource) return;

		//Fetch and sort items (3 from every provider)
		const generators = this.providers.map(x => x.get(query));
		const promises = generators.map(x => nFirst(x, 3));
		const items = (await Promise.all(promises)).flat();
		items.sort((a, b) => {
			const target = this.purify(query.toLowerCase().trim());
			const trackA = compareTwoStrings(target, this.stringify(a));
			const trackB = compareTwoStrings(target, this.stringify(b));
			if (trackA === trackB) {
				if (a.cover && !b.cover) return -1;
				if (b.cover && !a.cover) return 1;
			}

			return trackB - trackA;
		});

		const seen = new Set();
		//Return best sorted
		for (const item of items) {
			const hash = this.stringify(item);
			if (seen.has(hash)) continue;

			yield item;
			seen.add(hash);
		}

		//Return the rest
		const generator = mergeGenerators(generators);
		for await (const item of generator) {
			const hash = this.stringify(item);
			if (seen.has(hash)) continue;

			yield item;
			seen.add(hash);
		}
	}

	public async *desource(sources: string[]): AsyncGenerator<ITrack> {
		for (const source of sources) {
			const generators = this.providers.map(x => x.desource(source));
			const generator = mergeGenerators(generators);

			let found = false;
			for await (const item of generator) {
				found = true;
				yield item;
			}
			if (found) return;
		}
	}

	public async *recommend(source: ITrackInfo[]): AsyncGenerator<ITrack> {
		const promises = this.recommenders.map(x => x.recommend(source));
		let recommendations = (await Promise.all(promises)).flat();
		recommendations = shuffle(recommendations).slice(0, 100);

		for (const recommendation of recommendations) {
			const track = (await this.get(recommendation).next()).value;
			if (track) yield track;
		}
	}

	private stringify(track: ITrack): string {
		const title = track.title.toLowerCase().trim();
		const artists = track.artists
			.sort()
			.join()
			.toLowerCase()
			.trim();
		return this.purify(`${artists} - ${title}`);
	}

	private purify(title: string): string {
		return title.replace(/[+,&]/g, " ");
	}
}
