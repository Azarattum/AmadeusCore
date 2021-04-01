import { ITrack } from "../track.interface";
import { log, LogType } from "../../../common/utils.class";
import { gretch } from "gretchen";

export default abstract class Provider {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected abstract baseURL: string;

	public constructor(token: string) {
		this.token = token;
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

	protected async call(
		method: string,
		params: Record<string, any> = {}
	): Promise<unknown> {
		const encoded = new URLSearchParams({ ...this.params, ...params });

		const { error, data } = await gretch(
			method + "?" + encoded.toString(),
			{
				baseURL: this.baseURL,
				headers: this.headers
			}
		).json();

		if (error) throw error;
		return data;
	}

	abstract get(
		query: string,
		count: number,
		offset?: number
	): AsyncGenerator<ITrack>;

	abstract desource(source: string): AsyncGenerator<ITrack>;
}

export interface IParsed {
	title: string;
	artists: string[];
	album: string;
	year?: number;
}
