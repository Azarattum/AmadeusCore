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
	"searched" | "extended" | "reported" | "shared"
>() {
	private bot!: Telegraf<BotContext>;
	private messages: Map<number, number[]> = new Map();
	private statusCache: Map<Message.AudioMessage, Buffer> = new Map();
	private loaders: Map<number, NodeJS.Timeout> = new Map();
	private requests: Map<number, IRequest> = new Map();

	public async initialize(token: string): Promise<void> {
		this.bot = new Telegraf<BotContext>(token);

		this.bot.on("channel_chat_created", ctx => {
			console.log("CHAAAT!");
		});

		//Authentication middleware
		this.bot.use(async (ctx, next) => {
			const id = ctx.from?.id || 0;
			try {
				if (ctx.chat?.type == "private") {
					ctx.tenant = Tenant.fromTelegram(id);
					return next();
				} else {
					const admins = await ctx.getChatAdministrators();
					for (const admin of admins) {
						try {
							ctx.tenant = Tenant.fromTelegram(admin.user.id);
							return next();
						} catch {
							//Prceed to next
						}
					}

					ctx.leaveChat();
					this.emit(
						"reported",
						`Unauthorized playlist access from ${
							(ctx.chat as any).title
						} (${ctx.chat?.id})!`,
						Level.Normal
					);
				}
			} catch {
				this.emit(
					"reported",
					`Unauthorized access attempt from @${ctx.from?.username} (${ctx.from?.id})!`,
					Level.Normal
				);
			}
		});

		//Message middleware
		this.bot.use((ctx, next) => {
			if (ctx.chat && !this.messages.has(ctx.chat.id))
				this.messages.set(ctx.chat.id, []);

			ctx.sender = ctx.from?.username || (ctx.chat as any).title;
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

		this.bot.on(["text", "channel_post"], async ctx => {
			const text = ctx.message?.text || (ctx.channelPost as any).text;
			if (!text) return;
			if (text[0] == "/") this.handleCommand(ctx, text.slice(1));
			else this.emit("searched", ctx, text);
		});

		this.bot.on("audio", async ctx => {
			const text = [ctx.message.audio.performer, ctx.message.audio.title]
				.filter(x => x)
				.join(" - ");
			this.emit("searched", ctx, text);
		});

		this.bot.launch();
	}

	public async close(): Promise<void> {
		this.bot.stop();
	}

	public async sendTrack(
		ctx: BotContext,
		track: ITrack
	): Promise<Message.AudioMessage | void> {
		const status = await this.createStatus(ctx, track);
		const progress = (percent: number): void => {
			this.updateStatus(ctx, status, percent, track);
		};

		const buffer = await Loader.load(track, progress).catch(e => {
			this.emit(
				"reported",
				`Failed to load track "${track.title}"!\n${e}`,
				Level.Critical
			);
			ctx.deleteMessage(status.message_id);
		});

		if (!buffer) return;

		this.messages.get(ctx.chat?.id || 0)?.push(status.message_id);
		await this.updateStatus(ctx, status, 100, track, buffer);
		this.statusCache.set(status, buffer);

		return status;
	}

	public async requestPlaylist(
		ctx: BotContext,
		options: string[]
	): Promise<string> {
		const message = (
			await ctx.reply("...", {
				reply_markup: {
					keyboard: options.map(x => [x]),
					one_time_keyboard: true
				},
				disable_notification: true
			})
		).message_id;

		return new Promise((resolve, reject) => {
			this.requests.set(ctx.chat?.id || 0, {
				resolve,
				reject,
				options,
				message
			});
		});
	}

	public async playlistTrack(
		userId: number,
		playlistId: number,
		track: ITrack | number
	): Promise<void> {
		if (+track) {
			this.bot.telegram.forwardMessage(playlistId, userId, +track);
		} else {
			//
		}
	}

	public showLoader(ctx: BotContext): void {
		ctx.replyWithChatAction("record_voice");
		const loader = setInterval(
			() => ctx.replyWithChatAction("record_voice"),
			3000
		);

		this.loaders.set(ctx.chat?.id || 0, loader);
	}

	public hideLoader(ctx: BotContext): void {
		const loader = this.loaders.get(ctx.chat?.id || 0);
		if (loader) clearInterval(loader);
	}

	private handleCommand(ctx: BotContext, command: string): void {
		switch (command.split(" ")[0]) {
			case "clear": {
				let msg;
				while ((msg = this.messages.get(ctx.chat?.id || 0)?.shift())) {
					ctx.deleteMessage(msg);
				}
				break;
			}
			case "share": {
				const target = (ctx.message as any)?.["reply_to_message"];
				if (!target) return;
				if (!target.audio) return;
				this.emit("shared", ctx, target);
				break;
			}
			case "more": {
				this.emit("extended", ctx);
				break;
			}
		}
	}

	private async updateStatus(
		ctx: BotContext,
		status: Message.AudioMessage,
		percent: number,
		track: ITrack,
		source?: Buffer
	): Promise<void> {
		if (!source && this.statusCache.has(status)) return;

		let name = track.artists.join(", ") + " - " + track.title;
		const index = Math.min(
			name.length,
			Math.ceil(name.length * percent * 1.11111)
		);
		name = "<u>" + name.slice(0, index) + "</u>" + name.slice(index);

		return ctx.tg
			.editMessageMedia(status.chat.id, status.message_id, undefined, {
				type: "audio",
				parse_mode: "HTML",
				media: source ? { source } : status.audio?.file_id,

				title: track.title,
				performer: track.artists.join(", "),
				duration: Math.round(track.length),
				caption: percent < 1 ? name : undefined
			})
			.catch(async e => {
				if (source && percent >= 100 && percent < 115) {
					if (e.message.includes("message to edit not found")) return;
					if (e.message.includes("cancelled by new editMessageMedia"))
						return;

					this.emit(
						"reported",
						`Track "${
							track.title
						}" failed to upload (retry ${percent - 99})!\n${e}`,
						Level.Normal
					);

					await sleep(1000 + 1000 * Math.random());
					this.updateStatus(ctx, status, percent + 1, track, source);
				}
				console.log(e);
			})
			.then(async () => {
				if (this.statusCache.has(status) && !source) {
					this.emit(
						"reported",
						`Track "${track.title}" has overwritten metadata. Fixing...`,
						Level.Normal
					);

					await sleep(1000);
					this.updateStatus(
						ctx,
						status,
						100,
						track,
						this.statusCache.get(status)
					);
				}
			});
	}

	private async createStatus(
		ctx: BotContext,
		track: ITrack
	): Promise<Message.AudioMessage> {
		return ctx
			.replyWithAudio(
				!track.url ? { source: Readable.from(["0"]) } : track.url,
				{
					caption: track.artists.join(", ") + " - " + track.title,
					disable_notification: true
				}
			)
			.catch(() => {
				return ctx.replyWithAudio(
					{ source: Readable.from(["0"]) },
					{
						caption: track.artists.join(", ") + "-" + track.title,
						disable_notification: true
					}
				);
			});
	}
}

export type BotContext = Context & { tenant: Tenant; sender: string };

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
