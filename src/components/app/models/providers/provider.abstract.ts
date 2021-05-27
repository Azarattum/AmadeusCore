import { IPreview } from "../track.interface";
import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Provider<T = any> extends Fetcher {
	public async *get(
		query: string,
		from: TrackSource = "search"
	): AsyncGenerator<IPreview> {
		const sources: Record<
			TrackSource,
			(query: string) => AsyncGenerator<T>
		> = {
			search: this.search,
			artist: this.artist,
			source: this.identify,
			album: this.album
		};

		const source = sources[from].bind(this);
		if (!source) return;
		const tracks = source(query);

		try {
			for await (const track of tracks) {
				if (!this.validate(track)) continue;
				const converted = await this.convert(track);
				if (converted) yield converted;
			}
		} catch (e) {
			const err =
				e.toString() === "[object Object]" ? JSON.stringify(e) : e;
			const name = this.constructor.name;

			wrn(`${name} failed to get "${query}" from ${from}!\n${err}`);
		}
	}

	protected validate(track: T): boolean {
		return true;
	}

	protected abstract convert(track: T): IPreview | null;
	protected abstract identify(source: string): AsyncGenerator<T>;
	protected abstract search(query: string): AsyncGenerator<T>;
	protected abstract artist(query: string): AsyncGenerator<T>;
	protected abstract album(query: string): AsyncGenerator<T>;
}

export type TrackSource = "search" | "source" | "artist" | "album";
