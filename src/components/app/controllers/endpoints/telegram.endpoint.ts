import { Playlist } from ".prisma/client";
import { IComponentOptions } from "../../../common/component.interface";
import Restream from "../../models/restream";
import { IPreview, Tracks } from "../../models/track.interface";
import TelegramBase, { ICallbackData } from "./telegram.base";
import { first } from "../../models/generator";
import { err } from "../../../common/utils.class";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";

export default class Telegram extends TelegramBase {
	protected client: number;
	private loader?: NodeJS.Timeout;
	private messages: Record<number, number[]> = {};

	public constructor(args: IComponentOptions) {
		super(args);
		this.client = this.tenant.telegram;
	}

	public async initialize(token: string): Promise<void> {
		return Telegram.initialize(token, this);
	}

	public async close(): Promise<void> {
		Telegram.close();
	}

	public async clear(playlist?: Playlist): Promise<void> {
		if (!playlist) this.load(ClientState.None);
		const id = playlist?.telegram || this.client;

		const messages = this.messages[id] || [];
		const promises = messages.map(x =>
			Telegram.call("deleteMessage", { chat_id: id, message_id: x })
		);

		await Promise.all(promises);
	}

	public async add(tracks: Tracks, playlist: Playlist): Promise<void> {
		if (!playlist.telegram) return;
		for await (const track of tracks) {
			await this.upload(track, undefined, playlist.telegram).catch(e =>
				err(`Failed to add audio!\n${e?.stack || e}`)
			);
		}
	}

	protected async onMessage(message: string): Promise<void> {
		this.load(ClientState.Searching);
		const tracks = this.want("query", message);
		const track = await first(tracks);

		if (track) {
			this.load(ClientState.Uploading);
			const buttons = this.createButtons(message);
			await this.upload(track, buttons).catch(e =>
				err(`Failed to send audio!\n${e?.stack || e}`)
			);
		}
		this.load(ClientState.None);
	}

	protected async onCallback(
		data: ICallbackData,
		id: string,
		message: number,
		chat: number
	): Promise<void> {
		switch (data.type) {
			case "more": {
				if (!data.query) return;
				const tracks = await this.want("query", data.query);
				if (!tracks) return;
				first(tracks);
				const selection = await first(tracks, 10);

				Telegram.call("editMessageReplyMarkup", {
					chat_id: chat,
					message_id: message,
					reply_markup: {
						inline_keyboard: [
							this.createButtons(data.query),
							...this.createList(selection, data)
						]
					}
				}).catch(() => {});

				break;
			}

			case "close": {
				Telegram.call("editMessageReplyMarkup", {
					chat_id: chat,
					message_id: message,
					reply_markup: {
						inline_keyboard: [this.createButtons(data.query)]
					}
				}).catch(() => {});

				break;
			}

			case "download": {
				const source = data.source;
				if (source == null) return;
				this.load(ClientState.Searching);
				const track = await first(this.want("query", source));
				if (!track) {
					this.load(ClientState.None);
					return;
				}

				this.load(ClientState.Uploading);
				await this.upload(track, this.createButtons()).catch(e =>
					err(`Failed to send audio!\n${e?.stack || e}`)
				);
				this.load(ClientState.None);

				break;
			}
		}
	}

	protected onTagged(channel: string): void {
		this.emit("triggered", channel);
	}

	protected onPost(text: string, channel: string): void {
		throw new Error("Method not implemented.");
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

		if (!description) return this.emit("relisted", title, update) as any;
		description = description.toLowerCase();

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

	private createList(
		tracks: IPreview[],
		params: Record<string, any> = {}
	): Record<string, any>[] {
		const list = tracks.map((x, i) => [
			{
				text: `${x.artists.join(", ")} - ${x.title}`,
				callback_data: JSON.stringify({
					type: "download",
					source: x.source
				})
			}
		]);

		const close = {
			text: "✖",
			callback_data: JSON.stringify({ ...params, type: "close" })
		};

		list.push([close]);
		return list;
	}

	private createButtons(query?: string): Record<string, any>[] {
		const options = {
			"👤": "artist",
			"📻": "similar",
			"💿": "album"
		} as Record<string, string>;
		if (query) options["➕"] = "more";

		return Object.entries(options).map(x => ({
			text: x[0],
			callback_data: JSON.stringify({
				type: x[1],
				query
			})
		}));
	}

	private async upload(
		preview: IPreview,
		buttons?: Record<string, any>[],
		chat = this.client
	): Promise<number> {
		const track = await preview.track();
		const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);

		let message;
		if (tg) {
			message = await Telegram.call("sendAudio", {
				chat_id: chat,
				audio: tg,
				disable_notification: true
			});
		} else {
			const stream = await Restream.fromTrack(track);

			message = await Telegram.call("sendAudio", {
				chat_id: chat,
				audio: [stream.source, stream.filename],
				title: track.title,
				performer: track.artists.join(", "),
				duration: track.length,
				disable_notification: true,
				reply_markup: buttons
					? { inline_keyboard: [buttons] }
					: undefined
			});
		}

		const id = message.message_id;

		this.messages[chat] ??= [];
		this.messages[chat].push(id);
		const file =
			message.audio?.file_id || (message as any).document?.file_id;
		if (file) track.sources.push(`tg://${file}`);
		return id;
	}

	private load(state = ClientState.None): void {
		if (state === ClientState.None && this.loader) {
			clearInterval(this.loader);
			return;
		}

		const action = (): void => {
			Telegram.call("sendChatAction", {
				chat_id: this.client,
				action:
					state === ClientState.Searching
						? "record_voice"
						: "upload_voice"
			});
		};
		if (this.loader) clearInterval(this.loader);
		this.loader = setInterval(action, 3000);
		action();
	}
}

enum ClientState {
	None,
	Searching,
	Uploading
}
