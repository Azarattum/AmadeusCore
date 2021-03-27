import { Playlist } from ".prisma/client";
import fetch, { Response } from "node-fetch";
import { Readable } from "stream";
import { IComponentOptions } from "../../../common/component.interface";
import { log, LogType, sleep } from "../../../common/utils.class";
import Form from "../../models/form";
import Restream from "../../models/restream";
import Tenant from "../../models/tenant";
import { ITrack } from "../../models/track.interface";
import Endpoint from "./endpoint.abstract";
import AbortController from "abort-controller";
import PromisePool from "es6-promise-pool";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";

export default class Telegram extends Endpoint {
	private client: number;
	private messages: Map<number | undefined, number[]> = new Map();
	private tracks: Map<number, ITrack> = new Map();
	private loader?: number;
	private lastTrack?: ITrack;
	private tempMessages: number[] = [];
	private requests: IRequest[] = [];
	private aborts: Map<number | undefined, Set<AbortController>> = new Map();

	private static url: string;
	private static inited = false;
	private static clients: Map<number, Telegram> = new Map();
	private static abortController: AbortController;

	public constructor(args: IComponentOptions) {
		super(args);
		this.client = this.tenant.telegram;
	}

	public initialize(token: string): void {
		Telegram.initialize(token, this);
	}

	public async close(): Promise<void> {
		Telegram.inited = false;
		Telegram.abortController.abort();
	}

	public async setPlaylists(playlists: string[]): Promise<any> {
		if (!this.lastTrack) return;

		const response = await this.call("sendMessage", {
			text: "...",
			reply_markup: {
				keyboard: playlists.map(x => [x]),
				one_time_keyboard: true
			},
			disable_notification: true
		});

		if (!response.ok) return;
		const result = (await response.json())["result"];
		this.tempMessages.push(+result["message_id"]);
		this.requests.push({
			items: playlists,
			callback: (playlist: string) => {
				this.emit("playlisted", this.lastTrack, playlist);
				return true;
			}
		});
	}

	public async sendTracks(
		tracks: ITrack[],
		playlist?: Playlist
	): Promise<void> {
		clearInterval(this.loader);

		if (playlist && !playlist.telegram) return;
		const telegramPlaylist = playlist?.telegram || undefined;

		const generatePromises = function*(this: Telegram): any {
			for (const track of tracks) {
				const tg = track.sources
					.find(x => x.startsWith("tg://"))
					?.slice(5);
				if (tg) {
					yield this.call("sendAudio", {
						chat_id: telegramPlaylist || this.client,
						audio: tg,
						disable_notification: true
					});
				} else {
					yield this.sendTrack(track, telegramPlaylist).catch(e => {
						log(
							`Failed to send track "${track.title}"!\n${e}`,
							LogType.ERROR
						);
					});
				}
			}
		};

		const promiseIterator = generatePromises.bind(this)();
		const pool = new PromisePool(promiseIterator, playlist ? 3 : 10);
		await pool.start();
	}

	public async clearPlaylist(playlist?: Playlist): Promise<void> {
		const id = playlist?.telegram || undefined;
		this.aborts.get(id)?.forEach(x => x.abort());

		const messages = this.messages.get(id);
		if (!messages) return;

		const promises: Promise<any>[] = [];
		let message_id;
		while ((message_id = messages.shift())) {
			this.tracks.delete(message_id);
			const chat_id = playlist?.telegram || this.client;
			promises.push(this.call("deleteMessage", { chat_id, message_id }));
		}

		await Promise.all(promises);
	}

	private async sendTrack(track: ITrack, playlist?: number): Promise<void> {
		const status = await this.sendStatus(track, playlist);
		let source: Restream | null = await Restream.fromTrack(track);
		const abort = new AbortController();

		if (!this.messages.has(playlist)) this.messages.set(playlist, []);
		this.messages.get(playlist)?.push(status[0]);
		if (!this.aborts.has(playlist)) this.aborts.set(playlist, new Set());
		this.aborts.get(playlist)?.add(abort);

		let file: string | null = null;
		let loaded: number | null = 0;
		let request: Promise<any> | null = null;
		source.on("progress", async (progress: number) => {
			if (playlist) return;
			if (loaded === null) return;

			loaded = progress;
			await request;
			if (loaded != progress) return;
			if (file) return;

			request = this.updateStatus(status, progress, track, {
				abort
			}).catch(() => null);
		});

		source.on("beforeEnd", async () => {
			loaded = null;
			await request;
			source?.end();
		});

		const options = { source, playlist, abort };
		file = (
			await this.updateStatus(status, 1, track, options).catch(e => {
				if (e.message?.toString().startsWith("AbortError")) {
					return [null, null];
				}

				source?.destroy();
				throw e;
			})
		)[1];
		abort.abort();
		this.aborts.get(playlist)?.delete(abort);

		source.removeAllListeners();
		source.destroy();
		source = null;

		if (!file) return;
		track.sources.push(`tg://${file}`);
		this.tracks.set(status[0], track);
		if (playlist) return;
		this.lastTrack = track;
	}

	private async sendStatus(
		track: ITrack,
		playlist?: number
	): Promise<[number, string]> {
		const name = track.artists.join(", ") + " - " + track.title;
		const url = track.url;

		const empty = [Readable.from(["0"]), "Loading"];
		let response = await this.call("sendAudio", {
			...(playlist ? { chat_id: playlist } : {}),
			audio: url || empty,
			caption: name,
			disable_notification: true
		});

		if (!response.ok) {
			response = await this.call("sendAudio", {
				...(playlist ? { chat_id: playlist } : {}),
				audio: empty,
				caption: name,
				disable_notification: true
			});
		}

		const result = (await response.json())["result"];
		const message = +result["message_id"];
		const file =
			result["audio"]?.["file_id"] || result["document"]?.["file_id"];
		return [message, file];
	}

	private async updateStatus(
		status: [number, string],
		progress: number,
		track: ITrack,
		{ source, playlist, abort }: IUpdateOptions
	): Promise<[number, string]> {
		const name = track.artists.join(", ") + " - " + track.title;
		const index = Math.min(
			name.length,
			Math.ceil(name.length * progress * 1.11111)
		);
		const formatted =
			"<u>" + name.slice(0, index) + "</u>" + name.slice(index);

		const media = {
			type: "audio",
			parse_mode: "HTML",
			media:
				source && typeof source != "string"
					? "attach://audio"
					: source || status[1],

			title: track.title,
			performer: track.artists.join(", "),
			duration: Math.round(track.length),
			caption: !source ? formatted : undefined
		};

		const audio =
			source && typeof source != "string"
				? [source, name + ".mp3"]
				: undefined;

		const payload = {
			...(playlist ? { chat_id: playlist } : {}),
			message_id: status[0],
			media,
			audio
		};

		const response = await this.call("editMessageMedia", payload, abort);
		if (!response.ok) {
			if (!source) return status;
			throw new Error(await response.text());
		}

		const result = (await response.json())["result"];
		const message = +result["message_id"];
		const file =
			result["audio"]?.["file_id"] || result["document"]?.["file_id"];
		return [message, file];
	}

	private onMessage(message: string, data: any): void {
		let message_id;
		while ((message_id = this.tempMessages.shift())) {
			this.call("deleteMessage", { message_id });
		}

		const request = this.requests.find(x => x.items.includes(message));
		if (request?.callback(message)) return;

		this.startLoader();
		this.emit("searched", message);
	}

	private onCommand(command: string, data: any): void {
		const type = data?.["channel_post"]?.chat?.type;
		if (type === "channel") {
			command = command.replace(/@.*$/, "");
			switch (command) {
				case "update": {
					const playlist = data["channel_post"].chat?.title;
					if (!playlist) return;
					this.emit("triggered", playlist);
					break;
				}
			}
			return;
		}

		switch (command) {
			case "clear": {
				this.clearPlaylist();
				break;
			}
			case "playlist": {
				const target = data["message"]?.["reply_to_message"];
				if (target && target.audio) {
					this.lastTrack =
						this.tracks.get(target.message_id) || this.lastTrack;
				}
				this.emit("playlists");
				break;
			}
			case "more": {
				this.startLoader();
				this.emit("extended");
				break;
			}
		}
	}

	private onChat(chat: number, title: string, description?: string): void {
		const update = {
			telegram: chat,
			type: 0
		};

		if (!description) return this.emit("relist", title, update);
		description = description.toLocaleLowerCase();

		if (description.includes(UNTRACKED_TAG)) {
			update.type = -1;
		}
		if (description.includes(DISCOVER_TAG)) {
			update.type = 1;
		}
		if (description.includes(LISTEN_TAG)) {
			update.type = 2;
		}

		this.emit("relist", title, update);
	}

	private startLoader(): void {
		const action = (): void => {
			this.call("sendChatAction", {
				action: "record_voice"
			});
		};
		clearInterval(this.loader);
		this.loader = +setInterval(action, 3000);
		action();
	}

	private call(
		method: string,
		params: Record<string, any> = {},
		abort?: AbortController
	): Promise<Response> {
		return Telegram.call(
			method,
			{ chat_id: this.client, ...params },
			abort
		);
	}

	public static get relations(): object[] {
		return Tenant.tenants.filter(x => x.telegram);
	}

	private static async call(
		method: string,
		params: Record<string, any> = {},
		abortController?: AbortController
	): Promise<Response> {
		const mixedAbort = new AbortController();
		this.abortController.signal.addEventListener("abort", (): void => {
			mixedAbort.abort();
		});
		abortController?.signal.addEventListener("abort", (): void => {
			mixedAbort.abort();
		});

		return fetch(this.url + method, {
			method: "POST",
			headers: Form.headers,
			body: new Form(params),
			signal: mixedAbort.signal
		}).catch(e => {
			return {
				status: 503,
				text: (): string => e.toString(),
				json: () => null,
				ok: false
			} as any;
		});
	}

	private static async subscribe(offset = 0): Promise<void> {
		if (!this.inited) return;
		const response = await this.call("getUpdates", {
			offset,
			timeout: 30
		});
		if (!this.inited) return;

		//Timeout
		if (response.status == 502) {
			this.subscribe(offset);
			return;
		}
		//Error
		if (response.status != 200) {
			log(
				`Error code ${
					response.status
				} recieved on polling\n${await response.text()}`,
				LogType.ERROR
			);

			sleep(1000);
			this.subscribe(offset);
			return;
		}

		//Update
		const updates = (await response.json())["result"];
		if (!Array.isArray(updates)) {
			log(`Unknown update data ${updates} recieved!`, LogType.ERROR);

			await sleep(1000);
			this.subscribe(offset);
			return;
		}

		for (const update of updates) {
			this.update(update);
			offset = Math.max(offset, update["update_id"] + 1);
		}
		this.subscribe(offset);
	}

	private static async checkChannel(id: number): Promise<Telegram | null> {
		const adminsInfo = await this.call("getChatAdministrators", {
			chat_id: id
		});

		const admins = (await adminsInfo.json())["result"];
		if (Array.isArray(admins)) {
			for (const admin of admins) {
				const client = this.clients.get(admin.user.id);
				if (!client) continue;
				return client;
			}
		}

		return null;
	}

	private static async update(data: Record<string, any>): Promise<void> {
		if (data["message"]) {
			const message = data["message"];
			const sender = message["from"]?.["id"];
			const name = message["from"]?.["username"];
			if (!+sender) return;
			const client = this.clients.get(+sender);
			if (!client) {
				log(
					`Unauthorized access attempt from @${name} (${sender})!`,
					LogType.WARNING
				);
				return;
			}

			const text =
				message["text"] ||
				[message.audio.performer, message.audio.title]
					.filter(x => x)
					.join(" - ");

			if (!text) return;

			if (text[0] == "/") client.onCommand(text.slice(1), data);
			else client.onMessage(text, data);

			Telegram.call("deleteMessage", {
				chat_id: sender,
				message_id: message["message_id"]
			});
		} else if (data["my_chat_member"]) {
			const update = data["my_chat_member"];
			const member = update["new_chat_member"];
			const chat = update.chat.id;
			const title = update.chat.title;

			if (!member) return;
			if (member.status === "left") return;

			const chatInfo = await this.call("getChat", { chat_id: chat });

			const client = await this.checkChannel(chat);
			const info = (await chatInfo.json())["result"];
			if (client) {
				client.onChat(chat, title, info.description);
				return;
			}

			await this.call("leaveChat", { chat_id: chat });
			log(
				`Unauthorized "${title}" (${chat}) playlist access!`,
				LogType.WARNING
			);
		} else if (data["channel_post"]) {
			const post = data["channel_post"];
			const chat = post.chat?.id;
			const text = post.text;

			if (!chat) return;
			if (!text || text[0] !== "/") return;

			const client = await this.checkChannel(chat);
			if (!client) return;

			client.onCommand(text.slice(1), data);

			Telegram.call("deleteMessage", {
				chat_id: chat,
				message_id: post["message_id"]
			});
		}
	}

	public static initialize(token: string, instance: Telegram): void {
		this.clients.set(instance.client, instance);
		if (this.inited) return;
		this.url = "https://api.telegram.org/bot" + token + "/";
		this.abortController = new AbortController();
		this.inited = true;
		this.subscribe();
	}
}

interface IRequest {
	items: string[];
	callback: (response: string) => boolean;
}

interface IUpdateOptions {
	source?: Readable | string;
	playlist?: number;
	abort?: AbortController;
}
