import Fetcher from "../fetcher.abstract";
import { ITrack } from "../track.interface";

export default abstract class Recommender extends Fetcher {
	protected baseURL = "https://ws.audioscrobbler.com/2.0/";

	public constructor(token: string) {
		super(token);
	}

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

	public async getSimilar(track: ITrack, limit?: number): Promise<string[]> {
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
}
