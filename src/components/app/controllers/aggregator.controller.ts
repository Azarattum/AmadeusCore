import Controller from "../../common/controller.abstract";
import Provider, { TrackSource } from "../models/providers/provider.abstract";
import { compareTwoStrings } from "string-similarity";
import { IPreview, purify, stringify } from "../models/track.interface";
import { shuffle } from "../../common/utils.class";
import Recommender, {
	ITrackInfo
} from "../models/recommenders/recommender.abstract";
import { first, mergeGenerators } from "../models/generator";
import { is } from "typescript-is";
import parse from "../models/parser";

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

	public async *get(
		query: string,
		from: TrackSource = "search"
	): AsyncGenerator<IPreview> {
		//Return from desource
		const source = this.desource([query]);
		let fromSource = false;
		for await (const track of source) {
			fromSource = true;
			yield track;
		}
		if (fromSource || from == "source") return;

		//Fetch and sort items (3 from every provider)
		const generators = this.providers.map(x => x.get(query, from));
		const promises = generators.map(x => first(x, 4));
		const items = (await Promise.all(promises)).flat();
		//Sort relevant results higher when searching
		if (from == "search") items.sort((a, b) => this.compare(a, b, query));

		const seen = new Set();
		//Return best sorted
		for (const item of items) {
			const hash = stringify(item);
			const rev = stringify(item, true);
			if (seen.has(hash) || seen.has(rev)) continue;

			yield item;
			seen.add(hash);
		}

		//Return the rest
		const generator = mergeGenerators(generators);
		for await (const item of generator) {
			const hash = stringify(item);
			const rev = stringify(item, true);
			if (seen.has(hash) || seen.has(rev)) continue;

			yield item;
			seen.add(hash);
		}
	}

	public async *desource(
		sources: ({ sources: string[] | string } | string)[]
	): AsyncGenerator<IPreview> {
		for (const source of sources) {
			if (typeof source === "object") {
				let data = source.sources;
				//Desource JSON sources format
				if (typeof data === "string") {
					try {
						const parsed = JSON.parse(data);
						if (is<string[]>(parsed)) data = parsed;
						else throw "";
					} catch {
						data = [data.toString()];
					}
				}

				for await (const item of this.desource(data)) {
					yield item;
				}
				continue;
			}

			const generators = this.providers.map(x => x.get(source, "source"));
			const generator = mergeGenerators(generators);

			let found = false;
			for await (const item of generator) {
				found = true;
				yield item;
			}
			if (found) return;
		}
	}

	public async *recommend(
		source: ITrackInfo[],
		count = 100
	): AsyncGenerator<IPreview> {
		const promises = this.recommenders.map(x => x.recommend(source, count));
		let recommendations = (await Promise.all(promises)).flat();
		recommendations = shuffle(recommendations).slice(0, count);

		for (const recommendation of recommendations) {
			const track = (await this.get(recommendation).next()).value;
			if (track) yield track;
		}
	}

	private compare(a: IPreview, b: IPreview, query: string) {
		const target = purify(query.toLowerCase().trim());
		const preview = parse(query) as IPreview;
		const parsed = stringify(preview);

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
			nonspace === a.artists.join().replace(/\s+/g, "").toLowerCase() &&
			nonspace === b.artists.join().replace(/\s+/g, "").toLowerCase()
		) {
			return 0;
		}

		//Elaborate title matching
		if (target.includes("-")) {
			if (stringify(a, true) === parsed) return 1;
			else if (stringify(b, true) === parsed) return -1;

			if (
				a.title === preview.title &&
				b.title !== preview.title &&
				b.artists.sort().join().toLowerCase() !==
					preview.artists.sort().join().toLowerCase()
			) {
				return -1;
			}
			if (
				b.title === preview.title &&
				a.title !== preview.title &&
				a.artists.sort().join().toLowerCase() !==
					preview.artists.sort().join().toLowerCase()
			) {
				return 1;
			}
		}

		let trackA = compareTwoStrings(target, stringify(a));
		let trackB = compareTwoStrings(target, stringify(b));
		trackA = Math.max(trackA, compareTwoStrings(parsed, stringify(a)));
		trackB = Math.max(trackB, compareTwoStrings(parsed, stringify(b)));
		if (trackA === trackB) {
			if (a.cover && !b.cover) return -1;
			if (b.cover && !a.cover) return 1;
		}

		return trackB - trackA;
	}
}
