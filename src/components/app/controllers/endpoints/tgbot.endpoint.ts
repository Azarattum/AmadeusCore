import { Context, Telegraf } from "telegraf";
import { ITrack } from "../../models/track.interface";
import { sleep } from "../../../common/utils.class";
import { Message } from "telegraf/typings/telegram-types";
import { clearInterval } from "timers";
import Tenant from "../../models/tenant";
import Controller from "../../../common/controller.abstract";
import Loader from "../../models/loader";
import { Readable } from "stream";

export default class TelegramBot extends Controller<
	"searched" | "extended" | "reported" | "shared" | "joined"
>() {
	private bot!: Telegraf<BotContext>;
	private messages: Map<number, number[]> = new Map();
	private statusCache: Map<Message.AudioMessage, Buffer> = new Map();
	private loaders: Map<number, NodeJS.Timeout> = new Map();
	private requests: Map<number, IRequest> = new Map();
	private tracks: Map<number, ITrack> = new Map();

	public async initialize(token: string): Promise<void> {
		this.bot = new Telegraf<BotContext>(token);

		//Playlist middleware
		this.bot.use(async (ctx, next) => {
			const update = (ctx.update as any)?.["my_chat_member"];
			const member = update?.["new_chat_member"];

			if (!member) return next();
			if (member.user.id !== this.bot.botInfo?.id) return next();
			if (member.status === "left") return;

			const admins = await ctx.tg.getChatAdministrators(update.chat.id);
			for (const admin of admins) {
				try {
					ctx.tenant = Tenant.fromTelegram(admin.user.id);

					this.emit(
						"joined",
						ctx.tenant,
						update.chat.title,
						update.chat.id
					);
					return;
				} catch {
					//Proceed forward
				}
			}

			ctx.tg.leaveChat(update.chat.id);
			this.emit(
				"reported",
				`Unauthorized playlist access from ${update.chat.title} (${update.chat.id})!`,
				Level.Normal
			);
		});

		//Authentication middleware
		this.bot.use(async (ctx, next) => {
			if (!ctx.from) return;
			const id = ctx.from.id || 0;
			try {
				if (ctx.chat?.type == "private") {
					ctx.tenant = Tenant.fromTelegram(id);
					return next();
				} else {
					throw "";
				}
			} catch {
				this.emit(
					"reported",
					`Unauthorized access attempt from @${ctx.from.username} (${ctx.from.id})!`,
					Level.Normal
				);
			}
		});

		//Message middleware
		this.bot.use((ctx, next) => {
			if (ctx.chat && !this.messages.has(ctx.chat.id))
				this.messages.set(ctx.chat.id, []);

			ctx.deleteMessage().catch(() => {});

			if (this.requests.has(ctx.chat?.id || 0)) {
				const request = this.requests.get(
					ctx.chat?.id || 0
				) as IRequest;
				const text = (ctx.message as any).text;

				this.requests.delete(ctx.chat?.id || 0);
				ctx.deleteMessage(request.message);

				if (request.options.includes(text)) {
					request.resolve(text);
					return;
				} else {
					request.reject();
				}
			}

			return next();
		});

		this.bot.on("text", async ctx => {
			const text = ctx.message?.text || (ctx.channelPost as any).text;
			if (!text) return;
			if (text[0] == "/") this.handleCommand(ctx, text.slice(1));
			else this.emit("searched", ctx.tenant, text);
		});

		this.bot.on("audio", async ctx => {
			const text = [ctx.message.audio.performer, ctx.message.audio.title]
				.filter(x => x)
				.join(" - ");
			this.emit("searched", ctx.tenant, text);
		});

		this.bot.launch();
	}

	public async close(): Promise<void> {
		this.bot.stop();
	}

	public async sendTrack(
		chat: number,
		track: ITrack
	): Promise<Message.AudioMessage | void> {
		const status = await this.createStatus(chat, track);
		const progress = (percent: number): void => {
			this.updateStatus(chat, status, percent, track);
		};

		const buffer = await Loader.load(track, progress).catch(e => {
			this.emit(
				"reported",
				`Failed to load track "${track.title}"!\n${e}`,
				Level.Critical
			);
			this.tracks.delete(status.message_id);
			this.bot.telegram.deleteMessage(chat, status.message_id);
		});

		if (!buffer) return;

		const message = await this.updateStatus(
			chat,
			status,
			100,
			track,
			buffer
		);
		this.statusCache.set(status, buffer);
		this.messages.get(chat)?.push(message.message_id);
		track.sources.push(`tg://${message.message_id}`);

		return status;
	}

	public async requestPlaylist(
		chat: number,
		options: string[]
	): Promise<string> {
		const message = (
			await this.bot.telegram.sendMessage(chat, "...", {
				reply_markup: {
					keyboard: options.map(x => [x]),
					one_time_keyboard: true
				},
				disable_notification: true
			})
		).message_id;

		return new Promise((resolve, reject) => {
			this.requests.set(chat, {
				resolve,
				reject,
				options,
				message
			});
		});
	}

	public async playlistTrack(
		chat: number,
		playlist: number,
		track: ITrack
	): Promise<any> {
		const tg = track.sources.find(x => x.startsWith("tg://"))?.slice(5);
		if (tg && +tg) {
			return this.bot.telegram.forwardMessage(playlist, chat, +tg);
		} else {
			return this.sendTrack(playlist, track);
		}
	}

	public showLoader(chat: number): void {
		this.bot.telegram.sendChatAction(chat, "record_voice");
		const loader = setInterval(
			() => this.bot.telegram.sendChatAction(chat, "record_voice"),
			3000
		);

		this.loaders.set(chat, loader);
	}

	public hideLoader(chat: number): void {
		const loader = this.loaders.get(chat);
		if (loader) clearInterval(loader);
		this.loaders.delete(chat);
	}

	private handleCommand(ctx: BotContext, command: string): void {
		switch (command.split(" ")[0]) {
			case "clear": {
				let msg;
				while ((msg = this.messages.get(ctx.chat?.id || 0)?.shift())) {
					this.tracks.delete(msg);
					ctx.deleteMessage(msg);
				}
				break;
			}
			case "share": {
				const target = (ctx.message as any)?.["reply_to_message"];
				if (!target) return;
				if (!target.audio) return;
				const track = this.tracks.get(target.message_id);
				if (!track) return;

				this.emit("shared", ctx.tenant, track);
				break;
			}
			case "more": {
				this.emit("extended", ctx.tenant);
				break;
			}
		}
	}

	private async updateStatus(
		chat: number,
		status: Message.AudioMessage,
		percent: number,
		track: ITrack,
		source?: Buffer
	): Promise<Message.AudioMessage> {
		if (!source && this.statusCache.has(status)) return status;

		const name = track.artists.join(", ") + " - " + track.title;
		const index = Math.min(
			name.length,
			Math.ceil(name.length * percent * 1.11111)
		);
		const formatted =
			"<u>" + name.slice(0, index) + "</u>" + name.slice(index);

		const message = (await this.bot.telegram
			.editMessageMedia(status.chat.id, status.message_id, undefined, {
				type: "audio",
				parse_mode: "HTML",
				media: source
					? { source, filename: name + ".mp3" }
					: status.audio?.file_id,

				title: track.title,
				performer: track.artists.join(", "),
				duration: Math.round(track.length),
				caption: percent < 1 ? formatted : undefined
			})
			.catch(async e => {
				if (source && percent >= 100 && percent < 115) {
					if (e.message.includes("message to edit not found"))
						return status;
					if (e.message.includes("cancelled by new editMessageMedia"))
						return status;

					this.emit(
						"reported",
						`Track "${
							track.title
						}" failed to upload (retry ${percent - 99})!\n${e}`,
						Level.Normal
					);

					await sleep(1000 + 1000 * Math.random());
					return this.updateStatus(
						chat,
						status,
						percent + 1,
						track,
						source
					);
				}

				return status;
			})) as Message.AudioMessage;

		if (this.statusCache.has(status)) {
			if (source) {
				this.statusCache.delete(status);
				return message;
			}

			this.emit(
				"reported",
				`Track "${track.title}" has overwritten metadata. Fixing...`,
				Level.Normal
			);

			await sleep(1000);
			this.updateStatus(
				chat,
				status,
				100,
				track,
				this.statusCache.get(status)
			);
		}

		return message;
	}

	private async createStatus(
		chat: number,
		track: ITrack
	): Promise<Message.AudioMessage> {
		const message = await this.bot.telegram
			.sendAudio(
				chat,
				!track.url ? { source: Readable.from(["0"]) } : track.url,
				{
					caption: track.artists.join(", ") + " - " + track.title,
					disable_notification: true
				}
			)
			.catch(() => {
				return this.bot.telegram.sendAudio(
					chat,
					{ source: Readable.from(["0"]) },
					{
						caption: track.artists.join(", ") + "-" + track.title,
						disable_notification: true
					}
				);
			});

		this.tracks.set(message.message_id, track);
		return message;
	}
}

export type BotContext = Context & { tenant: Tenant };

export enum Level {
	Low,
	Normal,
	Critical
}

interface IRequest {
	resolve: (response: string) => void;
	reject: () => void;
	message: number;
	options: string[];
}
