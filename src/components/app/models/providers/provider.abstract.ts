import { ITrack } from "../track.interface";
import { sleep } from "../../../common/utils.class";
import { gretch } from "gretchen";

export default abstract class Provider<T> {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected abstract baseURL: string;

	public constructor(token: string) {
		this.token = token;
	}

	protected async call(
		method: string,
		params: Record<string, any> = {}
	): Promise<unknown> {
		const encoded = new URLSearchParams({ ...this.params, ...params });
		const args = encoded.toString() ? "?" + encoded.toString() : "";

		const use = () =>
			gretch(method + args, {
				baseURL: this.baseURL,
				headers: this.headers
			}).json();

		let res = await use();
		if (res.error?.type === "invalid-json") {
			await sleep(6);
			res = await use();
		}

		if (res.error) throw res.error;
		return res.data;
	}

	public async *get(
		query: string,
		count = 1,
		offset = 0
	): AsyncGenerator<ITrack> {
		const tracks = await this.search(query, count, offset);

		for await (const track of tracks) {
			const converted = await this.convert(track);
			if (!converted.url) continue;
			yield converted;
		}
	}

	public async *desource(source: string): AsyncGenerator<ITrack> {
		const tracks = await this.identify(source);

		for await (const track of tracks) {
			const converted = await this.convert(track);
			if (!converted.url) continue;
			yield converted;
		}
	}

	protected abstract convert(track: T): Promise<ITrack>;

	protected abstract identify(source: string): AsyncGenerator<T>;

	protected abstract search(
		query: string,
		count?: number,
		offset?: number
	): AsyncGenerator<T>;
}

export interface IParsed {
	title: string;
	artists: string[];
	album: string;
	year?: number;
}
