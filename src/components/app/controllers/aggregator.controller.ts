import Controller from "../../common/controller.abstract";
import Provider from "../models/providers/provider.abstract";
import { compareTwoStrings } from "string-similarity";
import { IPreview } from "../models/track.interface";
import { shuffle } from "../../common/utils.class";
import Recommender, {
	ITrackInfo
} from "../models/recommenders/recommender.abstract";
import { first, mergeGenerators } from "../models/generator";

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

	public async *get(query: string): AsyncGenerator<IPreview> {
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
		const promises = generators.map(x => first(x, 3));
		const items = (await Promise.all(promises)).flat();
		items.sort((a, b) => this.compare(a, b, query));

		const seen = new Set();
		//Return best sorted
		for (const item of items) {
			const hash = this.stringify(item);
			const rev = this.stringify(item, true);
			if (seen.has(hash) || seen.has(rev)) continue;

			yield item;
			seen.add(hash);
		}

		//Return the rest
		const generator = mergeGenerators(generators);
		for await (const item of generator) {
			const hash = this.stringify(item);
			const rev = this.stringify(item, true);
			if (seen.has(hash) || seen.has(rev)) continue;

			yield item;
			seen.add(hash);
		}
	}

	public async *desource(sources: string[]): AsyncGenerator<IPreview> {
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

	public async *recommend(source: ITrackInfo[]): AsyncGenerator<IPreview> {
		const promises = this.recommenders.map(x => x.recommend(source));
		let recommendations = (await Promise.all(promises)).flat();
		recommendations = shuffle(recommendations).slice(0, 100);

		for (const recommendation of recommendations) {
			const track = (await this.get(recommendation).next()).value;
			if (track) yield track;
		}
	}

	private compare(a: IPreview, b: IPreview, query: string) {
		const target = this.purify(query.toLowerCase().trim());

		//Exact title match
		if (
			!target.includes("-") &&
			target === a.title.toLowerCase() &&
			target === b.title.toLowerCase()
		) {
			return 0;
		}

		//Exact artist match
		const nonspace = target.replace(/\s+/g, "");
		if (
			!target.includes("-") &&
			nonspace ===
				a.artists
					.join()
					.replace(/\s+/g, "")
					.toLowerCase() &&
			nonspace ===
				b.artists
					.join()
					.replace(/\s+/g, "")
					.toLowerCase()
		) {
			return 0;
		}

		const trackA = compareTwoStrings(target, this.stringify(a));
		const trackB = compareTwoStrings(target, this.stringify(b));
		if (trackA === trackB) {
			if (a.cover && !b.cover) return -1;
			if (b.cover && !a.cover) return 1;
		}

		return trackB - trackA;
	}

	private stringify(track: IPreview, reverse = false): string {
		const title = track.title.toLowerCase().trim();
		const artists = track.artists
			.sort()
			.join()
			.toLowerCase()
			.trim();

		if (reverse) this.purify(`${title} - ${artists}`);
		return this.purify(`${artists} - ${title}`);
	}

	private purify(title: string): string {
		return title.replace(/[+,&]/g, " ");
	}
}
