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

export default class Telegram extends Endpoint {
	private client: number;
	private messages: number[] = [];
	private tracks: Map<number, ITrack> = new Map();
	private loader?: number;
	private share?: ITrack;
	private playlists: string[] = [];
	private tempMessages: number[] = [];

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
		this.playlists = playlists;

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
	}

	public async sendTracks(tracks: ITrack[]): Promise<void> {
		for (const track of tracks) {
			this.sendTrack(track).catch(e => {
				log(
					`Failed to send track "${track.title}"!\n${e}`,
					LogType.ERROR
				);
			});
		}
	}

	public async playlistTrack(
		track: ITrack,
		playlist: Playlist
	): Promise<void> {
		if (!playlist.telegram) return;

		const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);
		if (tg) {
			await this.call("sendAudio", {
				chat_id: playlist.telegram,
				audio: tg,
				disable_notification: true
			});
		} else {
			this.sendTrack(track, playlist.telegram);
		}
	}

	private async sendTrack(track: ITrack, playlist?: number): Promise<void> {
		clearInterval(this.loader);
		const status = await this.sendStatus(track, playlist);
		let source: Restream | null = await Restream.fromTrack(track);
		const abort = new AbortController();

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

		const options = { source, playlist };
		file = (
			await this.updateStatus(status, 1, track, options).catch(e => {
				source?.destroy();
				throw e;
			})
		)[1];
		abort.abort();
		this.tracks.set(status[0], track);
		track.sources.push(`tg://${file}`);
		this.messages.push(status[0]);

		source.removeAllListeners();
		source.destroy();
		source = null;
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

		if (this.share) {
			if (this.playlists.includes(message)) {
				this.emit("playlisted", this.share, message);
			}
			this.share = undefined;
			return;
		}

		this.startLoader();
		this.emit("searched", message);
	}

	private onCommand(command: string, data: any): void {
		switch (command) {
			case "clear": {
				let message_id;
				while ((message_id = this.messages.shift())) {
					this.tracks.delete(message_id);
					this.call("deleteMessage", { message_id });
				}
				break;
			}
			case "share": {
				const target = data["message"]?.["reply_to_message"];
				if (!target) return;
				if (!target.audio) return;
				const track = this.tracks.get(target.message_id);
				if (!track) return;
				this.share = track;
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

	private onChat(title: string, chat: number): void {
		this.emit("relist", title, chat);
	}

	private startLoader(): void {
		const action = (): void => {
			this.call("sendChatAction", {
				action: "record_voice"
			});
		};
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
				text: (): string => e,
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

			const response = await this.call("getChatAdministrators", {
				chat_id: chat
			});

			const admins = (await response.json())["result"];
			if (Array.isArray(admins)) {
				for (const admin of admins) {
					const client = this.clients.get(admin.user.id);
					if (!client) continue;
					client.onChat(title, chat);
					return;
				}
			}

			await this.call("leaveChat", { chat_id: chat });
			log(
				`Unauthorized "${title}" (${chat}) playlist access!`,
				LogType.WARNING
			);
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

interface IUpdateOptions {
	source?: Readable | string;
	playlist?: number;
	abort?: AbortController;
}