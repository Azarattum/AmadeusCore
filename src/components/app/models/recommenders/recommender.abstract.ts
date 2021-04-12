import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Recommender extends Fetcher {
	protected abstract assemble(source: ITrackInfo[]): Promise<string[]>;

	public recommend(source: ITrackInfo[]): Promise<string[]> {
		return this.assemble(source).catch(e => {
			wrn(
				`${this.constructor.name} failed to recommend "${source
					.map(x => x.title)
					.join(", ")
					.slice(0, 20)}..."!\n${e}`
			);

			return [];
		});
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
