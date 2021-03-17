import Application, { handle } from "../common/application.abstract";
import { log, LogType } from "../common/utils.class";
import Aggregator from "./controllers/aggregator.controller";
import { ITrack } from "./models/track.interface";
import Preserver from "./controllers/preserver.controller";
import TelegramBot from "./controllers/endpoints/tgbot.endpoint";
import Tenant from "./models/tenant";
import { Playlist } from "@prisma/client";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Preserver, Aggregator, TelegramBot]);
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

		bot.on("searched", async (tenant: Tenant, query: string) => {
			log(`${tenant.identifier} searched for "${query}"...`);

			bot.showLoader(tenant.telegram);
			const aggregator = this.getComponent(Aggregator, tenant);
			const track = await aggregator.single(query);
			bot.hideLoader(tenant.telegram);
			if (!track) return;

			bot.sendTrack(tenant.telegram, track).catch(e => {
				log(
					`Failed to send track "${track.title}"!\n${e}`,
					LogType.ERROR
				);
			});
		});

		bot.on("extended", async (tenant: Tenant) => {
			log(`${tenant.identifier} requested more tracks...`);

			bot.showLoader(tenant.telegram);
			const aggregator = this.getComponent(Aggregator, tenant);
			const tracks = await aggregator.more(async (tracks: ITrack[]) => {
				bot.hideLoader(tenant.telegram);
				for (const track of tracks) {
					bot.sendTrack(tenant.telegram, track).catch(e => {
						log(
							`Failed to send track "${track.title}"!\n${e}`,
							LogType.ERROR
						);
					});
				}
			});
			bot.hideLoader(tenant.telegram);

			log(
				`${tracks?.length || 0} tracks found for ${tenant.identifier}.`
			);
		});

		bot.on("shared", async (tenant: Tenant, track: ITrack) => {
			const preserver = this.getComponent(Preserver, tenant);
			const playlists = (await preserver.getPlaylists()).map(
				x => x.title
			);

			const playlist = await bot
				.requestPlaylist(tenant.telegram, playlists)
				.catch(() => {});
			if (!playlist) return;

			preserver.playlistTrack(track, playlist);

			log(
				`${tenant.identifier} shared track "${track.title}" to "${playlist}".`
			);
		});

		bot.on(
			"joined",
			async (tenant: Tenant, playlist: string, telegram: number) => {
				log(
					`Bot joined ${tenant.identifier}'s playlist "${playlist}".`
				);

				const preserver = this.getComponent(Preserver, tenant);
				preserver.updatePlaylist(playlist, telegram);
			}
		);
	}

	@handle(Preserver)
	private onPreserver(preserver: Preserver): void {
		preserver.on(
			"playlisted",
			(tenant: Tenant, track: ITrack, playlist: Playlist) => {
				const bot = this.getComponent(TelegramBot);

				if (playlist.telegram) {
					bot.playlistTrack(
						tenant.telegram,
						playlist.telegram,
						track
					).catch(() => {
						preserver.updatePlaylist(playlist.title, null);
					});
				}
			}
		);
	}
}
