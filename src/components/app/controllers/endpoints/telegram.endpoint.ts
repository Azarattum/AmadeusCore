import { Playlist } from ".prisma/client";
import { Readable } from "stream";
import { IComponentOptions } from "../../../common/component.interface";
import { log, LogType } from "../../../common/utils.class";
import Restream from "../../models/restream";
import { ITrack } from "../../models/track.interface";
import AbortController from "abort-controller";
import TelegramBase from "./telegram.base";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";

export default class Telegram extends TelegramBase {
	protected client: number;
	private loader?: number;
	private messages: Record<number, number[]> = {};
	private aborts: Record<number, Set<AbortController>> = {};

	public constructor(args: IComponentOptions) {
		super(args);
		this.client = this.tenant.telegram;
	}

	public initialize(token: string): void {
		Telegram.initialize(token, this);
	}

	public async close(): Promise<void> {
		Telegram.close();
	}

	public async send(
		tracks: AsyncGenerator<ITrack>,
		playlist?: Playlist
	): Promise<any> {
		clearInterval(this.loader);

		const chat = playlist?.telegram || this.client;
		for await (const track of tracks) {
			await this.upload(track, chat).catch(e => {
				log(
					`Failed to send track "${track.title}"!\n${e}`,
					LogType.ERROR
				);
			});
		}
	}

	public async clear(playlist?: Playlist): Promise<any> {
		const id = playlist?.telegram || this.client;
		this.aborts[id]?.forEach(x => x.abort());

		const messages = this.messages[id] || [];
		const promises = messages.map(x => {
			return this.call("deleteMessage", {
				chat_id: id,
				message_id: x
			});
		});

		return await Promise.all(promises);
	}
	
	protected onMessage(message: string): void {
		this.load();
		this.emit("searched", message);
	}

	protected onCommand(command: string): void {
		switch (command) {
			case "clear": {
				this.clear();
				break;
			}
		}
	}

	protected onChat(chat: number, title: string, description?: string): void {
		const update = {
			telegram: chat,
			type: 0
		};

		if (!description) return this.emit("relisted", title, update);
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

		this.emit("relisted", title, update);
	}

	private async upload(track: ITrack, chat: number): Promise<any> {
		const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);
		if (tg) {
			return this.call("sendAudio", {
				chat_id: chat,
				audio: tg,
				disable_notification: true
			});
		}

		const status = await this.sendStatus(track, chat);
		let source: Restream | null = await Restream.fromTrack(track);
		const abort = new AbortController();

		this.messages[chat] ??= [];
		this.messages[chat].push(status[0])

		this.aborts[chat] ??= new Set();
		this.aborts[chat].add(abort);

		let file: string | null = null;
		let loaded: number | null = 0;
		let request: Promise<any> | null = null;
		source.on("progress", async (progress: number) => {
			if (chat) return;
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

		const options = { source, playlist: chat, abort };
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
		this.aborts[chat].delete(abort);

		source.removeAllListeners();
		source.destroy();
		source = null;

		if (!file) return;
		track.sources.push(`tg://${file}`);
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

	private load(): void {
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
}

interface IUpdateOptions {
	source?: Readable | string;
	playlist?: number;
	abort?: AbortController;
}
