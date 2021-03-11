import Application, { handle } from "../common/application.abstract";
import { log, LogType } from "../common/utils.class";
import TelegramBot, {
	BotContext
} from "./controllers/endpoints/tgbot.endpoint";
import Aggregator from "./models/aggregator";
import { ITrack } from "./models/track.interface";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Aggregator, TelegramBot]);
	}

	/**
	 * Initializes the app
	 */
	public async initialize(): Promise<void> {
		await super.initialize(
			[TelegramBot, process.env["BOT_TOKEN"]],
			[
				Aggregator,
				{
					vk: process.env["VK_TOKEN"],
					yandex: process.env["YANDEX_TOKEN"],
					soundCloud: process.env["SOUNDCLOUD_TOKEN"],
					youTube: process.env["YOUTUBE_TOKEN"]
				}
			]
		);
	}

	@handle(TelegramBot)
	private onTelegramBot(bot: TelegramBot): void {
		bot.on("reported", (message: string, level: number) => {
			const levels = [LogType.INFO, LogType.WARNING, LogType.ERROR];
			log(message, levels[level]);
		});

		bot.on("searched", async (ctx: BotContext, query: string) => {
			log(`${ctx.from?.username} searched for "${query}"...`);

			bot.showLoader(ctx);
			const aggregator = this.getComponent(Aggregator, ctx.tenant);
			const track = await aggregator.single(query);
			bot.hideLoader(ctx);
			if (!track) return;

			bot.sendTrack(ctx, track).catch(e => {
				log(
					`Failed to send track "${track.title}"!\n${e}`,
					LogType.ERROR
				);
			});
		});

		bot.on("extended", async (ctx: BotContext) => {
			log(`${ctx.from?.username} requested more tracks...`);

			bot.showLoader(ctx);
			const aggregator = this.getComponent(Aggregator, ctx.tenant);
			const tracks = await aggregator.more((tracks: ITrack[]) => {
				bot.hideLoader(ctx);
				for (const track of tracks) {
					bot.sendTrack(ctx, track).catch(e => {
						log(
							`Failed to send track "${track.title}"!\n${e}`,
							LogType.ERROR
						);
					});
				}
			});
			bot.hideLoader(ctx);

			log(
				`${tracks?.length || 0} tracks found for ${ctx.from?.username}.`
			);
		});
	}
}
