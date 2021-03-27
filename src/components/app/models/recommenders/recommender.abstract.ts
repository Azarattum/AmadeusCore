import { Playlist } from ".prisma/client";
import Fetcher from "../fetcher.abstract";

export default abstract class Recommender extends Fetcher {
	protected baseURL = "https://ws.audioscrobbler.com/2.0/";

	public constructor(token: string) {
		super(token);
	}

	public abstract get(
		source: TrackSource,
		playlist: Playlist
	): Promise<string[]>;

	protected async call(
		method: string,
		params: Record<string, any> = {}
	): Promise<any> {
		const payload = {
			api_key: this.token,
			format: "json",
			method: method,
			...params
		};

		return (await super.call("", payload)).json();
	}

	protected async getSimilar(
		track: { title: string; artists: string[] },
		limit?: number
	): Promise<string[]> {
		const similar = (
			await this.call("track.getsimilar", {
				track: track.title,
				artist: track.artists.join(", "),
				limit
			})
		)?.["similartracks"]?.["track"];

		if (!similar) return [];

		const result = similar.map((x: any) => {
			return [x.artist?.name, x.name].filter(x => x).join(" - ");
		}) as string[];

		return result;
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

export type TrackSource = (
	count: number
) => Promise<{ title: string; artists: string[] }[]>;
