/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/camelcase */
import Endpoint from "./endpoint.abstract";
import { Context, Telegraf } from "telegraf";
import Aggregator from "../aggregator";
import fetch from "node-fetch";
import { ITrack } from "../track.interface";
import Ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { Promise as Meta } from "node-id3";
import { log, LogType, sleep } from "../../../common/utils.class";
import { Message } from "telegraf/typings/telegram-types";
import { clearInterval } from "timers";

export default class TelegramBotEndpoint extends Endpoint {
	private bot: Telegraf;
	private messages: Map<number, number[]> = new Map();
	private aggregator: Map<number, Aggregator> = new Map();
	private statusCache: Map<Message.AudioMessage, Buffer> = new Map();

	public constructor(token: string) {
		super();
		this.bot = new Telegraf(token);
	}

	private async updateStatus(
		ctx: Context,
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

					log(
						`Track "${
							track.title
						}" failed to upload (retry ${percent - 99})!\n${e}`,
						LogType.WARNING
					);

					await sleep(1000);
					this.updateStatus(ctx, status, percent + 1, track, source);
				}
			})
			.then(async () => {
				if (this.statusCache.has(status) && !source) {
					log(
						`Track "${track.title}" has overwritten metadata. Fixing...`,
						LogType.WARNING
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
		ctx: Context,
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

	private async sendTrack(
		ctx: Context,
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

		stream.on("error", () => {
			log(`Failed to load track "${track.title}"!`, LogType.ERROR);
			ctx.deleteMessage(status.message_id);
		});

		return status;
	}

	private showLoading(ctx: Context): NodeJS.Timeout {
		ctx.replyWithChatAction("record_voice");
		return setInterval(() => ctx.replyWithChatAction("record_voice"), 3000);
	}

	private async searchTracks(ctx: Context, query: string): Promise<void> {
		const loading = this.showLoading(ctx);
		log(`${ctx.from?.username} searched for "${query}"...`);
		const track = await this.aggregator.get(ctx.chat?.id || 0)?.get(query);
		clearInterval(loading);
		if (!track) return;

		this.sendTrack(ctx, track).catch(e => {
			log(`Failed to send track "${track.title}"!\n${e}`, LogType.ERROR);
		});
	}

	private async moreTracks(ctx: Context): Promise<ITrack[] | undefined> {
		const loading = this.showLoading(ctx);
		log(`${ctx.from?.username} requested more tracks...`);

		const tracks = await this.aggregator
			.get(ctx.chat?.id || 0)
			?.more((tracks: ITrack[]) => {
				clearInterval(loading);

				for (const track of tracks) {
					this.sendTrack(ctx, track).catch(e => {
						log(
							`Failed to send track "${track.title}"!\n${e}`,
							LogType.ERROR
						);
					});
				}
			});

		log(`${tracks?.length || 0} track found for ${ctx.from?.username}.`);
		clearInterval(loading);

		return tracks;
	}

	private handleCommand(ctx: Context, command: string): void {
		switch (command) {
			case "clear": {
				let msg;
				while ((msg = this.messages.get(ctx.chat?.id || 0)?.shift())) {
					ctx.deleteMessage(msg);
				}
				break;
			}
			case "more": {
				this.moreTracks(ctx);
				break;
			}
		}
	}

	private setupResoponse(ctx: Context): void {
		ctx.deleteMessage().catch(() => {});
		if (ctx.chat && !this.aggregator.has(ctx.chat.id))
			this.aggregator.set(ctx.chat.id, new Aggregator());
		if (ctx.chat && !this.messages.has(ctx.chat.id))
			this.messages.set(ctx.chat.id, []);
	}

	public async start(): Promise<void> {
		this.bot.on("text", async ctx => {
			this.setupResoponse(ctx);

			const text = ctx.message.text;
			if (text[0] == "/") this.handleCommand(ctx, text.slice(1));
			else this.searchTracks(ctx, text);
		});

		this.bot.on("audio", async ctx => {
			this.setupResoponse(ctx);

			const text = [ctx.message.audio.performer, ctx.message.audio.title]
				.filter(x => x)
				.join(" - ");
			this.searchTracks(ctx, text);
		});

		this.bot.launch();
	}
}
