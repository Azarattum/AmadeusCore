import { ITrack } from "../track.interface";
import { sleep, wrn } from "../../../common/utils.class";
import { gretch } from "gretchen";

export default abstract class Provider<T = any> {
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
		const url = new URL(method, this.baseURL);
		const encoded = new URLSearchParams({
			...Object.fromEntries(url.searchParams),
			...this.params,
			...params
		});
		url.search = encoded.toString();

		const use = () =>
			gretch(url.toString(), {
				headers: this.headers
			}).json();

		let res = await use();
		if (res.error?.type === "invalid-json") {
			await sleep(6);
			res = await use();
		}

		if (res.error) throw { status: res.status, eroor: res.error };
		return res.data;
	}

	public async *get(query: string): AsyncGenerator<ITrack> {
		const tracks = this.search(query);

		try {
			for await (const track of tracks) {
				if (!this.validate(track)) continue;
				const converted = await this.convert(track);
				if (!converted.url) continue;
				yield converted;
			}
		} catch (e) {
			wrn(`${this.constructor.name} failed to get "${query}"!\n${e}`);
		}
	}

	public async *desource(source: string): AsyncGenerator<ITrack> {
		const tracks = this.identify(source);

		try {
			for await (const track of tracks) {
				if (!this.validate(track)) continue;
				const converted = await this.convert(track);
				if (!converted.url) continue;
				yield converted;
			}
		} catch (e) {
			wrn(
				`${this.constructor.name} failed to desource "${source}"!\n${e}`
			);
		}
	}

	protected validate(track: T): boolean {
		return true;
	}

	protected abstract convert(track: T): Promise<ITrack | { url: undefined }>;

	protected abstract identify(source: string): AsyncGenerator<T>;

	protected abstract search(query: string): AsyncGenerator<T>;
}

export interface IParsed {
	title: string;
	artists: string[];
	album: string;
	year?: number;
}
