import { shuffle, wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Recommender extends Fetcher {
	protected abstract assemble(
		source: ITrackInfo,
		count: number
	): Promise<string[]>;

	public async recommend(
		source: ITrackInfo[],
		count = 100
	): Promise<string[]> {
		const tracks = this.normalPick(source, source.length);
		const results: string[] = [];

		let used = 0;
		for (const track of tracks) {
			//Dynamic adaptive limit amounts
			/**How differnt tracks are allowed to be */
			const deviation = 5;
			/**Gives advantage to the most recent tracks */
			const bias = 3 * Math.exp(-1 * ((1 / Math.sqrt(count)) * used)) + 3;
			/**Keeps track of the amount of tracks left to choose from */
			const left = tracks.length - used++;
			/**An amount to pick from similars */
			const pick = Math.min(
				Math.ceil(((count - results.length) / left) * bias),
				100
			);
			/**Requested amount of similar songs */
			const sim = pick * deviation;

			try {
				const similars = await this.assemble(track, sim);
				results.push(...this.normalPick(similars, pick));
			} catch (e) {
				const msg =
					typeof e === "object" ? JSON.stringify(e) : e.toString();

				wrn(
					`${this.constructor.name} failed to assemble recommendations from "${track.title}"!\n${msg}`
				);
			}
			if (results.length >= count) break;
		}

		return shuffle(results.slice(0, count));
	}

	protected normalRand(max: number): number {
		const deviation = max / 2.5;
		const scalar = 2 / (deviation * Math.sqrt(2 * Math.PI));

		const func = (x: number): number =>
			scalar * Math.exp(-0.5 * Math.pow(x / deviation, 2));

		const random = Math.random();
		let sum = 0;
		for (let i = 0; i < max; i++) {
			sum += func(i);
			if (sum >= random) {
				return i;
			}
		}

		return max - 1;
	}

	protected normalPick<T>(collection: T[], count = 1): T[] {
		collection = [...collection];
		const picked: T[] = [];
		for (let i = 0; i < count; i++) {
			const item = collection.splice(
				this.normalRand(collection.length),
				1
			);

			picked.push(...item);
		}

		return picked;
	}
}

export interface ITrackInfo {
	title: string;
	artists: string[];
}
