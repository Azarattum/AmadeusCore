import { ITrack } from "../track.interface";
import fetch, { Response } from "node-fetch";

export default abstract class Provider {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected abstract baseURL: string;

	public constructor(token: string) {
		this.token = token;
	}

	protected call(
		method: string,
		params: Record<string, any> = {}
	): Promise<Response> {
		const url = new URL(this.baseURL + method);
		url.search = new URLSearchParams({
			...this.params,
			...params
		}).toString();

		return fetch(url, {
			headers: this.headers
		});
	}

	abstract get(query: string, count: number): Promise<ITrack[]>;
}
