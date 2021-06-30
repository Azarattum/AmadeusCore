import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";
import { ITrackInfo } from "../track.interface";

export default abstract class Recommender extends Fetcher {
	protected abstract assemble(
		source: ITrackInfo,
		count: number
	): Promise<string[]>;

	public async *recommend(
		source: ITrackInfo[],
		count = 100
	): AsyncGenerator<string> {
		const tracks = this.normalPick(source, source.length);
		let processed = 0;
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
				Math.ceil(((count - processed) / left) * bias),
				100
			);
			/**Requested amount of similar songs */
			const sim = pick * deviation;

			try {
				const similars = this.normalPick(
					await this.assemble(track, sim),
					pick
				);

				for (const similar of similars) {
					yield similar;
					processed++;
					if (processed >= count) return;
				}
			} catch (e) {
				if (e.toString() === "[object Object]") {
					// eslint-disable-next-line no-ex-assign
					e = JSON.stringify(e);
				}

				wrn(
					`${this.constructor.name} failed to assemble recommendations from "${track.title}"!\n${e}`
				);
			}
		}
	}

	protected normalPick<T>(collection: T[], count = 1): T[] {
		return Recommender.normalPick(collection, count);
	}

	public static normalRand(max: number): number {
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

	public static normalPick<T>(collection: T[], count = 1): T[] {
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
