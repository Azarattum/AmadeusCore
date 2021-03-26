import fetch, { Response, RequestInit, RequestInfo } from "node-fetch";
import { log, LogType, sleep } from "../../common/utils.class";

export default abstract class Fetcher {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected abstract baseURL: string;
	private readonly maxRetries = 10;

	public constructor(token: string) {
		this.token = token;
	}

	protected fetch(url: RequestInfo, params?: RequestInit): Promise<Response> {
		let retries = 0;
		const doFetch = (resolve: Function, reject: Function): void => {
			if (retries > this.maxRetries) {
				log(
					`Request from ${this.constructor.name} to "${url}" rejected!`,
					LogType.ERROR
				);

				reject();
				return;
			}

			fetch(url, params)
				.then(x => {
					resolve(x);
				})
				.catch(async () => {
					log(
						`Request from ${
							this.constructor.name
						} to "${url}" failed (retry ${++retries})!`,
						LogType.WARNING
					);

					await sleep(500);
					doFetch(resolve, reject);
				});
		};

		return new Promise((resolve, reject) => {
			doFetch(resolve, reject);
		});
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

		return this.fetch(url, {
			headers: this.headers
		});
	}
}
