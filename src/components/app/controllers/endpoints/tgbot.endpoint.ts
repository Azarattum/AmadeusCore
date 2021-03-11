/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/camelcase */
import { Context, Telegraf } from "telegraf";
import fetch from "node-fetch";
import { ITrack } from "../../models/track.interface";
import Ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { Promise as Meta } from "node-id3";
import { sleep } from "../../../common/utils.class";
import { Message } from "telegraf/typings/telegram-types";
import { clearInterval } from "timers";
import Tenant from "../../models/tenant";
import Controller from "../../../common/controller.abstract";

export default class TelegramBot extends Controller<
	"searched" | "extended" | "reported"
>() {
	private bot!: Telegraf<BotContext>;
	private messages: Map<number, number[]> = new Map();
	private statusCache: Map<Message.AudioMessage, Buffer> = new Map();
	private loaders: Map<Context, NodeJS.Timeout> = new Map();

	public async initialize(token: string): Promise<void> {
		this.bot = new Telegraf<BotContext>(token);

		//Authentication middleware
		this.bot.use((ctx, next) => {
			const id = ctx.from?.id || 0;
			try {
				ctx.tenant = Tenant.fromTelegram(id);
				return next();
			} catch {
				this.emit(
					"reported",
					`Unauthorized access attempt from @${ctx.from?.username}!`,
					Level.Normal
				);
			}
		});

		//Message track middleware
		this.bot.use((ctx, next) => {
			ctx.deleteMessage().catch(() => {});
			if (ctx.chat && !this.messages.has(ctx.chat.id))
				this.messages.set(ctx.chat.id, []);
			return next();
		});

		this.bot.on("text", async ctx => {
			const text = ctx.message.text;
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
		if (!track.url) return;
		const dataLoad = fetch(track.url).catch(e => {
			throw e;
		});
		const coverLoad = track.cover
			? fetch(track.cover).catch(() => undefined)
			: undefined;

		const [data, cover] = await Promise.all([dataLoad, coverLoad]);
		const type = data.headers.get("content-type");
		const length = +(data.headers.get("content-length") || 0);

		const status = await this.createStatus(ctx, type, track);

		const stream =
			type == "audio/webm"
				? Ffmpeg(Readable.from(data.body))
						.format("mp3")
						.noVideo()
						.on("error", () => {})
						.pipe()
				: Readable.from(data.body);

		const buffers: any[] = [];
		let loaded = 0;
		let prev = 0;
		stream.on("data", buffer => {
			loaded += buffer.length;
			buffers.push(buffer);

			const percent = Math.round((loaded / length) * 100);
			if (percent - prev > 10) {
				this.updateStatus(ctx, status, percent, track);
				prev = percent;
			}
		});

		const meta = {
			title: track.title,
			artist: track.artists.join(", "),
			album: track.album,
			year: track.year?.toString(),
			length: track.length.toString(),
			APIC: cover ? await cover.buffer() : undefined
		};

		stream.on("close", async () => {
			loaded = -1;
			const buffer = await Meta.update(meta, Buffer.concat(buffers));

			this.messages.get(ctx.chat?.id || 0)?.push(status.message_id);
			await this.updateStatus(ctx, status, 100, track, buffer);
			this.statusCache.set(status, buffer);
		});

		stream.on("error", e => {
			this.emit(
				"reported",
				`Failed to load track "${track.title}"!\n${e}`,
				Level.Critical
			);
			ctx.deleteMessage(status.message_id);
		});

		return status;
	}

	public showLoader(ctx: BotContext): void {
		ctx.replyWithChatAction("record_voice");
		const loader = setInterval(
			() => ctx.replyWithChatAction("record_voice"),
			3000
		);

		this.loaders.set(ctx, loader);
	}

	public hideLoader(ctx: BotContext): void {
		const loader = this.loaders.get(ctx);
		if (loader) clearInterval(loader);
	}

	private handleCommand(ctx: BotContext, command: string): void {
		switch (command) {
			case "clear": {
				let msg;
				while ((msg = this.messages.get(ctx.chat?.id || 0)?.shift())) {
					ctx.deleteMessage(msg);
				}
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

		return ctx.tg
			.editMessageMedia(status.chat.id, status.message_id, undefined, {
				type: "audio",
				parse_mode: "Markdown",
				media: source ? { source } : status.audio?.file_id,

				title: track.title,
				performer: track.artists.join(", "),
				duration: Math.round(track.length),
				caption:
					percent >= 100
						? undefined
						: track.title +
						  ": `[" +
						  "#".repeat(percent / 10 + 1) +
						  " ".repeat(9 - percent / 10) +
						  "]`"
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

					await sleep(1000);
					this.updateStatus(ctx, status, percent + 1, track, source);
				}
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
		type: string | null,
		track: ITrack
	): Promise<Message.AudioMessage> {
		return ctx
			.replyWithAudio(
				type == "audio/webm" || !track.url
					? { source: Readable.from(["0"]) }
					: track.url,
				{
					caption: track.title + ": `[" + " ".repeat(10) + "]`",
					parse_mode: "Markdown"
				}
			)
			.catch(() => {
				return ctx.replyWithAudio(
					{ source: Readable.from(["0"]) },
					{
						caption: track.title + ": `[" + " ".repeat(10) + "]`",
						parse_mode: "Markdown"
					}
				);
			});
	}
}

export type BotContext = Context & { tenant: Tenant };

export enum Level {
	Low,
	Normal,
	Critical
}
