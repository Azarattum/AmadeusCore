import { Playlist } from ".prisma/client";
import { IComponentOptions } from "../../../common/component.interface";
import Restream from "../../models/restream";
import { IPreview, stringify, Tracks } from "../../models/track.interface";
import TelegramBase, { ICallbackData } from "./telegram.base";
import { first } from "../../models/generator";
import { err, generateID, shuffle } from "../../../common/utils.class";
import AbortController from "abort-controller";
import { Readable } from "stream";
import { TrackSource } from "../../models/providers/provider.abstract";
import { ITrackInfo } from "../../models/recommenders/recommender.abstract";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";
const PER_PAGE = 10;
const CACHE_LIMIT = 10;
const LIMITS = {
	"0": 1, //Searches
	"1": 3, //Downloads
	"2": 1 //Queueing
} as Record<TaskType, number>;

export default class Telegram extends TelegramBase {
	protected client: number;
	private loader?: NodeJS.Timeout;
	private messages: Record<number, Record<number, IMessage>> = {};
	private cache: TrackCache;
	private issued: Set<string> = new Set();
	private tasks: Map<string, ITask> = new Map();

	public constructor(args: IComponentOptions) {
		super(args);
		this.client = this.tenant.telegram;
		this.cache = {
			search: {},
			artist: {},
			album: {},
			source: {},
			similar: {}
		};
	}

	public async initialize(token: string): Promise<void> {
		return Telegram.initialize(token, this);
	}

	public async close(): Promise<void> {
		this.tasks.forEach((x, i) => this.endTask(i));
		this.issued.clear();
		Telegram.close();
	}

	public async clear(playlist?: Playlist): Promise<void> {
		const id = playlist?.telegram || this.client;
		const messages = this.messages[id] || [];

		this.tasks.forEach((x, i) => x.playlist === id && this.endTask(i));
		const promises = Object.keys(messages).map(x =>
			Telegram.call("deleteMessage", { chat_id: id, message_id: +x })
		);

		this.messages[id] = [];
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
		const tracks = await this.requestTracks(message, "search", 0, 1);

		if (tracks[0]) {
			await this.upload(tracks[0], message).catch(e =>
				err(`Failed to send audio!\n${e?.stack || e}`)
			);
		}
	}

	protected async onCallback(
		data: ICallbackData,
		message: number,
		chat: number
	): Promise<void> {
		const ctx = this.messages[chat]?.[message];
		if (!ctx) return;

		const update = async (
			list?: Record<string, any>[]
		): Promise<boolean> => {
			list ||= await this.createList(ctx);
			if (!list.length && ctx.type) return false;

			const buttons = [this.createButtons(!!ctx.search), ...list];

			Telegram.call("editMessageReplyMarkup", {
				chat_id: chat,
				message_id: message,
				reply_markup: { inline_keyboard: buttons }
			}).catch(() => {});
			return !!list.length;
		};

		switch (data.type) {
			case "artists": {
				if (!ctx.artists || !ctx.artists.length) return;
				if (ctx.artists.length > 1) {
					await update(
						ctx.artists.map(x => [
							{
								text: x,
								callback_data: JSON.stringify({
									type: "artist",
									arg: x
								})
							}
						])
					);
				} else {
					ctx.page = 0;
					ctx.query = ctx.artists[0];
					ctx.type = "artist";
					await update();
				}
				break;
			}

			case "more": {
				if (!ctx.search) return;
				ctx.page = 0;
				ctx.query = ctx.search;
				ctx.type = "search";
				await update();
				break;
			}

			case "artist": {
				const source = data.arg;
				if (source == null) return;
				ctx.page = 0;
				ctx.query = source;
				ctx.type = "artist";
				await update();
				break;
			}

			case "album": {
				if (!ctx.album) return;
				ctx.page = 0;
				ctx.query = [ctx.artists.join(", "), ctx.album]
					.filter(x => x)
					.join(" - ");

				ctx.type = "album";
				await update();
				break;
			}

			case "similar": {
				if (!ctx.album) return;
				ctx.page = 0;
				ctx.query = "similar";
				ctx.type = "similar";
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

				const abort = new AbortController();
				const task = await this.startTask(TaskType.Searching, abort);
				const track = await first(this.want("query", source, "source"));
				if (abort.signal.aborted) return;

				this.endTask(task);
				if (!track) return;
				await this.upload(track, "").catch(e =>
					err(`Failed to send audio!\n${e?.stack || e}`)
				);
				break;
			}

			case "page": {
				if (!ctx.query || !ctx.type || ctx.page == null) return;
				const tracks = await this.requestFromContext(ctx);

				tracks.forEach(x =>
					this.upload(x, "").catch(e =>
						err(`Failed to send audio!\n${e?.stack || e}`)
					)
				);

				break;
			}

			case "shuffle": {
				if (!ctx.query || !ctx.type || ctx.page == null) return;
				let tracks = await this.requestFromContext(ctx, 200);
				tracks = shuffle(tracks).slice(0, 10);

				tracks.forEach(x =>
					this.upload(x, "").catch(e =>
						err(`Failed to send audio!\n${e?.stack || e}`)
					)
				);

				break;
			}

			case "all": {
				if (!ctx.query || !ctx.type || ctx.page == null) return;

				const abort = new AbortController();
				const task = await this.startTask(TaskType.Queueing, abort);
				let page = 0;

				while (!abort.signal.aborted) {
					const tracks = await this.requestFromContext({
						...ctx,
						page
					});
					if (!tracks.length) break;
					if (abort.signal.aborted) break;

					await Promise.all(
						tracks.map(x =>
							this.upload(x, "").catch(e =>
								err(`Failed to send audio!\n${e?.stack || e}`)
							)
						)
					);
					page++;
				}
				this.endTask(task);

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
		id: number,
		file?: string
	): Promise<void> {
		const abort = new AbortController();
		const task = await this.startTask(TaskType.Searching, abort, id);
		const track = await first(this.want("query", text, "search"));
		if (abort.signal.aborted) return;

		this.endTask(task);
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
			case "cancel": {
				this.tasks.forEach(
					(x, i) => x.playlist === this.client && this.endTask(i)
				);
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
		query: string | ITrackInfo,
		from: ExtendedSource = "search",
		offset = 0,
		count = 10
	): Promise<IPreview[]> {
		if (from === "similar" && typeof query === "string") return [];

		let task;
		try {
			const hash =
				typeof query == "string"
					? query
					: [query.artists.join(", "), query.title]
							.filter(x => x)
							.join(" - ");

			const cached = this.cache[from]?.[hash];
			const source = cached || {
				history: [],
				iterator:
					typeof query == "string" && from != "similar"
						? this.want("query", query, from)
						: this.want("similar", query as ITrackInfo)
			};

			if (!cached) {
				this.cache[from] ??= {};
				this.cache[from][hash] = source;
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
				const abort = new AbortController();
				if (!offset) {
					task = await this.startTask(TaskType.Searching, abort);
				}

				const length = offset + count - source.history.length;
				const skip = Math.max(offset - source.history.length, 0);

				if (skip) first(source.iterator, skip);
				const loaded = await first(source.iterator, length);
				if (abort.signal.aborted) return tracks;

				source.history.push(...loaded);
				tracks.push(...loaded);
			}
			return tracks;
		} finally {
			if (task) this.endTask(task);
		}
	}

	private async requestFromContext(
		ctx: IMessage,
		max?: number
	): Promise<IPreview[]> {
		if (ctx.query == null || ctx.type == null || ctx.page == null) {
			return [];
		}

		return await this.requestTracks(
			ctx.type == "similar" ? ctx : ctx.query,
			ctx.type,
			max ? 0 : ctx.page * PER_PAGE + (ctx.type == "search" ? 1 : 0),
			max || PER_PAGE
		);
	}

	private async createList(ctx: IMessage): Promise<Record<string, any>[]> {
		if (ctx.query == null || ctx.type == null || ctx.page == null) {
			return [];
		}

		const tracks = await this.requestFromContext(ctx);

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

	private createButtons(moreButton: boolean = false): Record<string, any>[] {
		const options = {
			"👤": "artists",
			"📻": "similar",
			"💿": "album"
		} as Record<string, string>;
		if (moreButton) options["🔎"] = "more";

		return Object.entries(options).map(x => ({
			text: x[0],
			callback_data: JSON.stringify({
				type: x[1]
			})
		}));
	}

	private async startTask(
		type: TaskType,
		abort?: AbortController,
		playlist: number = this.client
	): Promise<string> {
		const id = generateID();

		const limit = LIMITS[type];
		let resolve: (() => void) | undefined;
		let waiting: Promise<void> | undefined;
		const tasks = [...this.tasks.values()].filter(
			x => x.type === type && !x.resolve
		);

		if (tasks.length >= limit) {
			waiting = new Promise(loaded => {
				resolve = loaded;
			});
		}

		this.tasks.set(id, { type, playlist, abort, resolve });
		await waiting;

		const action = (): void => {
			const tasks = [...this.tasks.values()];
			const isSearching = tasks.some(
				x => x.type === TaskType.Searching && x.playlist === this.client
			);
			const isUploading = tasks.some(
				x => x.type === TaskType.Uploading && x.playlist === this.client
			);
			if (!isSearching && !isUploading) {
				if (this.loader) clearInterval(this.loader);
				return;
			}

			Telegram.call("sendChatAction", {
				chat_id: this.client,
				action: isUploading ? "upload_voice" : "record_voice"
			});
		};
		if (this.loader) clearInterval(this.loader);
		this.loader = setInterval(action, 3000);
		action();

		return id;
	}

	private endTask(id: string) {
		const task = this.tasks.get(id);
		if (!task) return;
		task.abort?.abort();
		this.tasks.get(id)?.abort?.abort();
		this.tasks.delete(id);

		//Resove the first queued element
		for (const value of this.tasks.values()) {
			if (value.type !== task.type) continue;
			if (!value.resolve) continue;
			value.resolve();
			value.resolve = undefined;
			break;
		}
	}

	private async upload(
		preview: IPreview,
		query: string | null,
		chat = this.client
	): Promise<void> {
		let source: Readable | undefined;
		const abort = new AbortController();
		const task = await this.startTask(TaskType.Uploading, abort, chat);
		if (abort.signal.aborted) return;
		try {
			const track = await preview.track();
			if (abort.signal.aborted) return;
			const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);

			const buttons = query !== null ? this.createButtons(!!query) : null;

			let message;
			if (tg) {
				message = await Telegram.call(
					"sendAudio",
					{
						chat_id: chat,
						audio: tg,
						disable_notification: true,
						reply_markup: buttons
							? { inline_keyboard: [buttons] }
							: undefined
					},
					abort
				);
			} else {
				const stream = await Restream.fromTrack(track);
				if (abort.signal.aborted) return;
				source = stream.source;
				message = await Telegram.call(
					"sendAudio",
					{
						chat_id: chat,
						audio: [source, stream.filename],
						title: track.title,
						performer: track.artists.join(", "),
						duration: track.length,
						disable_notification: true,
						reply_markup: buttons
							? { inline_keyboard: [buttons] }
							: undefined
					},
					abort
				);
			}

			const id = message.message_id;
			this.messages[chat] ??= {};
			this.messages[chat][id] = {
				title: track.title,
				artists: track.artists,
				album: track.album
			};
			if (query) this.messages[chat][id].search = query;

			const file = message.audio?.file_id || message.document?.file_id;
			if (file) track.sources.push(`tg://${file}`);
		} catch (e) {
			if (!e.toString().includes('"type":"aborted"')) {
				throw e;
			}
		} finally {
			source?.destroy();
			this.endTask(task);
		}
	}
}

type ExtendedSource = TrackSource | "similar";

interface IMessage {
	/**Paging type */
	type?: ExtendedSource;
	/**Paging request */
	query?: string;
	/**Paging state */
	page?: number;

	/**Initial search request */
	search?: string;
	/**Track artists */
	artists: string[];
	/**Track title */
	title: string;
	/**Track album */
	album: string;
}

interface ITask {
	type: TaskType;
	playlist: number;
	abort?: AbortController;
	resolve?: () => void;
}

enum TaskType {
	Searching,
	Uploading,
	Queueing
}

type TrackCache = Record<
	ExtendedSource,
	Record<string, { history: IPreview[]; iterator: Tracks }>
>;
