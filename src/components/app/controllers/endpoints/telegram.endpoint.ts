import { Playlist } from ".prisma/client";
import { IComponentOptions } from "../../../common/component.interface";
import Restream from "../../models/restream";
import { IPreview, stringify, Tracks } from "../../models/track.interface";
import TelegramBase, { ICallbackData } from "./telegram.base";
import { first } from "../../models/generator";
import { err } from "../../../common/utils.class";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";
const PER_PAGE = 10;
const CACHE_LIMIT = 10;

export default class Telegram extends TelegramBase {
	protected client: number;
	private loader?: NodeJS.Timeout;
	private messages: Record<number, Record<number, IMessage>> = {};
	private cache: TrackCache;
	private issued: Set<string> = new Set();

	public constructor(args: IComponentOptions) {
		super(args);
		this.client = this.tenant.telegram;
		this.cache = {
			query: {}
		};
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

		const promises = Object.keys(messages).map(x =>
			Telegram.call("deleteMessage", { chat_id: id, message_id: +x })
		);

		await Promise.all(promises);
	}

	public async add(tracks: Tracks, playlist: Playlist): Promise<void> {
		if (!playlist.telegram) return;
		for await (const track of tracks) {
			if (this.issued.delete(stringify(track))) continue;
			await this.upload(track, null, playlist.telegram).catch(e =>
				err(`Failed to add audio!\n${e?.stack || e}`)
			);
		}
	}

	protected async onMessage(message: string): Promise<void> {
		this.load(ClientState.Searching);
		const tracks = await this.requestTracks(message, "query", 0, 1);

		if (tracks[0]) {
			this.load(ClientState.Uploading);
			await this.upload(tracks[0], message).catch(e =>
				err(`Failed to send audio!\n${e?.stack || e}`)
			);
		}
		this.load(ClientState.None);
	}

	protected async onCallback(
		data: ICallbackData,
		message: number,
		chat: number
	): Promise<void> {
		const ctx = this.messages[chat]?.[message];
		if (!ctx) return;

		const update = async (): Promise<boolean> => {
			const list = await this.createList(ctx);
			const buttons = [this.createButtons(ctx.query), ...list];

			Telegram.call("editMessageReplyMarkup", {
				chat_id: chat,
				message_id: message,
				reply_markup: { inline_keyboard: buttons }
			}).catch(() => {});
			return !!list.length;
		};

		switch (data.type) {
			case "more": {
				if (!ctx.query) return;
				ctx.page = 0;
				ctx.type = "query";
				await update();
				break;
			}

			case "close": {
				ctx.type = undefined;
				ctx.page = undefined;
				await update();
				break;
			}

			case "next": {
				if (ctx.page == null) return;
				ctx.page++;
				if (!(await update())) ctx.page--;
				break;
			}

			case "prev": {
				if (!ctx.page) return;
				ctx.page--;
				await update();
				break;
			}

			case "download": {
				const source = data.arg;
				if (source == null) return;
				this.load(ClientState.Searching);
				const track = await first(this.want("query", source));
				if (!track) {
					this.load(ClientState.None);
					return;
				}
				this.load(ClientState.Uploading);
				await this.upload(track, "").catch(e =>
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

	protected async onPost(
		text: string,
		channel: string,
		file?: string
	): Promise<void> {
		const track = await first(this.want("query", text));
		if (!track) return;
		this.issued.add(stringify(track));

		const load = track.track;
		track.track = async () => {
			const loaded = await load();
			if (file) loaded.sources.push(`tg://${file}`);
			return loaded;
		};

		this.emit("playlisted", track, channel);
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

	private async requestTracks(
		query: string,
		from: TrackSource = "query",
		offset = 0,
		count = 10
	): Promise<IPreview[]> {
		const cached = this.cache[from]?.[query];
		const source = cached || {
			history: [],
			iterator: this.want(from, query)
		};
		if (!cached) {
			this.cache[from] ??= {};
			this.cache[from][query] = source;
			//Cache control
			const keys = Object.keys(this.cache[from]);
			if (keys.length > CACHE_LIMIT) {
				delete this.cache[from][keys[0]];
			}
		}

		const tracks = [];
		//Load from history
		if (offset < source.history.length) {
			tracks.push(...source.history.slice(offset, offset + count));
		}
		//Request new data
		if (offset + count > source.history.length) {
			const length = offset + count - source.history.length;
			const loaded = await first(source.iterator, length);
			source.history.push(...loaded);
			tracks.push(...loaded);
		}

		return tracks;
	}

	private async createList(ctx: IMessage): Promise<Record<string, any>[]> {
		if (ctx.query == null || ctx.type == null || ctx.page == null) {
			return [];
		}

		const tracks = await this.requestTracks(
			ctx.query,
			ctx.type,
			ctx.page * PER_PAGE + 1,
			PER_PAGE
		);

		const list = tracks.map((x, i) => [
			{
				text: `${x.artists.join(", ")} - ${x.title}`,
				callback_data: JSON.stringify({
					type: "download",
					arg: x.source
				})
			}
		]);

		const close = {
			text: "❌",
			callback_data: JSON.stringify({ type: "close" })
		};

		const prev = {
			text: "👈",
			callback_data: JSON.stringify({ type: "prev" })
		};

		const next = {
			text: "👉",
			callback_data: JSON.stringify({ type: "next" })
		};

		const page = {
			text: "⬇️",
			callback_data: JSON.stringify({ type: "page" })
		};

		const shuffle = {
			text: "🔀",
			callback_data: JSON.stringify({ type: "shuffle" })
		};

		const all = {
			text: "⏬",
			callback_data: JSON.stringify({ type: "all" })
		};

		if (list.length) list.push([prev, close, next]);
		if (list.length) list.push([page, shuffle, all]);
		return list;
	}

	private createButtons(query?: string): Record<string, any>[] {
		const options = {
			"👤": "artist",
			"📻": "similar",
			"💿": "album"
		} as Record<string, string>;
		if (query) options["🔎"] = "more";

		return Object.entries(options).map(x => ({
			text: x[0],
			callback_data: JSON.stringify({
				type: x[1]
			})
		}));
	}

	private async upload(
		preview: IPreview,
		query: string | null,
		chat = this.client
	): Promise<number> {
		const track = await preview.track();
		const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);

		const buttons = query !== null ? this.createButtons(query) : null;

		let message;
		if (tg) {
			message = await Telegram.call("sendAudio", {
				chat_id: chat,
				audio: tg,
				disable_notification: true,
				reply_markup: buttons
					? { inline_keyboard: [buttons] }
					: undefined
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
		this.messages[chat] ??= {};
		this.messages[chat][id] = {
			title: track.title,
			artists: track.artists,
			album: track.album
		};
		if (query) this.messages[chat][id].query = query;

		const file = message.audio?.file_id || message.document?.file_id;
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

type TrackSource = "query";

interface IMessage {
	type?: TrackSource;
	query?: string;
	page?: number;

	artists: string[];
	title: string;
	album: string;
}

type TrackCache = Record<
	TrackSource,
	Record<string, { history: IPreview[]; iterator: Tracks }>
>;
