import { ITrack } from "../track.interface";
import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Provider<T = any> extends Fetcher {
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
