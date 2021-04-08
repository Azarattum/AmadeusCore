import Controller from "../../common/controller.abstract";
import Provider from "../models/providers/provider.abstract";
import SoundCloudProvider from "../models/providers/soundcloud.provider";
import VKProvider from "../models/providers/vk.provider";
import YandexProvider from "../models/providers/yandex.provider";
import YouTubeProvider from "../models/providers/youtube.provider";
import { compareTwoStrings } from "string-similarity";
import { ITrack } from "../models/track.interface";
import { mergeGenerators, nFirst } from "../../common/utils.class";

/**
 * Aggregates track data from all Amadeus' providers
 */
export default class Aggregator extends Controller() {
	private providers: Provider[] = [];

	public initialize(tokens: Record<string, string>): void {
		type provider = new (token: string) => Provider;

		const providers: Record<string, provider> = {
			vk: VKProvider,
			yandex: YandexProvider,
			soundcloud: SoundCloudProvider,
			youtube: YouTubeProvider
		};

		for (const i in providers) {
			const provider = new providers[i](tokens[i]);
			this.providers.push(provider);
		}
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
			const target = query.toLowerCase().trim();
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
				if (this.validate(item)) yield item;
			}
			if (found) return;
		}
	}

	private stringify(track: ITrack): string {
		const title = track.title.toLowerCase().trim();
		const artists = track.artists
			.sort()
			.join()
			.toLowerCase()
			.trim();
		return `${artists} - ${title}`;
	}
}
