/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { gretch } from "gretchen";
import { URL, URLSearchParams } from "url";
import { promisify } from "util";
import WebSocket from "ws";
import { sleep } from "../../common/utils.class";

/**
 * Implements basic fetching functionality given a base url
 */
export default abstract class Fetcher {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected baseURL: string = "";

	protected socket: WebSocket | null = null;

	public constructor(token: string = "TOKEN") {
		if (token.includes("/")) {
			const parts = token.split("/");
			this.params[parts[0]] = parts[1];
			token = "TOKEN";
		}
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

	protected async connect(): Promise<void> {
		this.socket = new WebSocket(this.baseURL, {
			servername: "",
			rejectUnauthorized: false
		} as any);
		await promisify(this.socket.on.bind(this.socket))("open");
	}

	protected async close(): Promise<void> {
		if (!this.socket) return;
		this.socket.close();

		await promisify(this.socket.on.bind(this.socket))(
			"close"
		).catch(() => {});
	}

	protected async send(
		data: obj | string | Buffer,
		wait = false
	): Promise<unknown> {
		if (!this.socket) return;
		if (typeof data === "object" && !(data instanceof Buffer)) {
			data = JSON.stringify(data);
		}

		this.socket?.send(data);

		if (!wait) return;
		return this.wait();
	}

	protected async wait(): Promise<unknown> {
		return new Promise(resolve => {
			this.socket?.once("message", data => {
				try {
					resolve(JSON.parse(data.toString()));
				} catch {
					resolve(data);
				}
			});
		});
	}
}
