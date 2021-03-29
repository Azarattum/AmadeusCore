import { ITrack } from "../track.interface";
import { log, LogType } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Provider extends Fetcher {
	public constructor(token: string) {
		super(token);
	}

	protected async update<T>(
		args: any[][],
		method: (...args: any) => Promise<T>,
		callback: (result: T, index: number) => void
	): Promise<void[]> {
		const updates: Promise<void>[] = [];
		for (const i in args) {
			const promise = method
				.bind(this)(...args[i])
				.then(x => {
					callback(x, +i);
				})
				.catch(e => {
					log(
						`${JSON.stringify(args[i])} skiped by ${
							this.constructor.name
						} (failed to load)!\n${e}`,
						LogType.WARNING
					);
				});

			updates.push(promise);
		}

		return Promise.all(updates);
	}

	abstract get(
		query: string,
		count: number,
		offset?: number
	): Promise<ITrack[]>;

	abstract desource(source: string): Promise<string | null>;
}

export interface IParsed {
	title: string;
	artists: string[];
	album: string;
	year?: number;
}
