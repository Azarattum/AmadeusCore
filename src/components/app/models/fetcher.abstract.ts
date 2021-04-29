import { gretch } from "gretchen";
import { URL, URLSearchParams } from "url";
import { sleep } from "../../common/utils.class";

/**
 * Implements basic fetching functionality given a base url
 */
export default abstract class Fetcher {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected baseURL: string = "";

	public constructor(token: string = "TOKEN") {
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
}
