import { IPreview } from "../track.interface";
import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Provider<T = any> extends Fetcher {
	public async *get(query: string): AsyncGenerator<IPreview> {
		const tracks = this.search(query);

		try {
			for await (const track of tracks) {
				if (!this.validate(track)) continue;
				const converted = await this.convert(track);
				if (converted) yield converted;
			}
		} catch (e) {
			const err =
				e.toString() === "[object Object]" ? JSON.stringify(e) : e;

			wrn(`${this.constructor.name} failed to get "${query}"!\n${err}`);
		}
	}

	public async *desource(source: string): AsyncGenerator<IPreview> {
		const tracks = this.identify(source);

		try {
			for await (const track of tracks) {
				if (!this.validate(track)) continue;
				const converted = await this.convert(track);
				if (converted) yield converted;
			}
		} catch (e) {
			const err =
				e.toString() === "[object Object]" ? JSON.stringify(e) : e;

			wrn(
				`${this.constructor.name} failed to desource "${source}"!\n${err}`
			);
		}
	}

	protected validate(track: T): boolean {
		return true;
	}

	protected abstract convert(track: T): IPreview | null;

	protected abstract identify(source: string): AsyncGenerator<T>;

	protected abstract search(query: string): AsyncGenerator<T>;
}
