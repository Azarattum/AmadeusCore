import Application, { handle } from "../common/application.abstract";
import { log } from "../common/utils.class";
import Aggregator from "./controllers/aggregator.controller";
import { ITrack } from "./models/track.interface";
import Preserver from "./controllers/preserver.controller";
import { Playlist } from "@prisma/client";
import Telegram from "./controllers/endpoints/telegram.endpoint";
import Endpoint from "./controllers/endpoints/endpoint.abstract";
import Scheduler from "./controllers/scheduler.controller";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Aggregator, Preserver, Scheduler, Telegram]);
	}

	/**
	 * Initializes the app
	 */
	public async initialize(): Promise<void> {
		await super.initialize(
			[Telegram, process.env["BOT_TOKEN"]],
			[
				Aggregator,
				{
					vk: process.env["VK_TOKEN"],
					yandex: process.env["YANDEX_TOKEN"],
					soundCloud: process.env["SOUNDCLOUD_TOKEN"],
					lastfm: process.env["LASTFM_TOKEN"]
				}
			]
		);
	}

	@handle(Endpoint)
	private onEndpoint(endpoint: Endpoint): void {
		const name = endpoint.tenant.identifier;
		const aggregator = this.getComponent(Aggregator, endpoint.tenant);
		const preserver = this.getComponent(Preserver, endpoint.tenant);
		const scheduler = this.getComponent(Scheduler, endpoint.tenant);

		endpoint.on("searched", async (query: string) => {
			log(`${name} searched for "${query}"...`);

			const track = await aggregator.single(query);
			if (!track) {
				endpoint.sendTracks([]);
				return;
			}
			endpoint.sendTracks([track]);
		});

		endpoint.on("extended", async () => {
			log(`${name} requested more tracks...`);

			const tracks = await aggregator.extend(async (tracks: ITrack[]) => {
				endpoint.sendTracks(tracks);
			});

			log(`${tracks?.length || 0} tracks found for ${name}.`);
		});

		endpoint.on("playlists", async () => {
			log(`${name} requested his/her playlists.`);
			const playlists = (await preserver.getPlaylists()).map(
				x => x.title
			);

			endpoint.setPlaylists(playlists);
		});

		endpoint.on("playlisted", async (track: ITrack, playlist: string) => {
			log(`${name} added track "${track.title}" to "${playlist}".`);

			preserver.addTrack(track, playlist);
		});

		endpoint.on("relist", (playlist: string, update: any) => {
			log(`${name} updated "${playlist}" playlist.`);

			preserver.updatePlaylist(playlist, update);
		});

		endpoint.on("triggered", (playlist: string) => {
			log(`${name} triggered an update on "${playlist}" playlist.`);

			scheduler.trigger([playlist]);
		});
	}

	@handle(Preserver)
	private onPreserver(preserver: Preserver): void {
		preserver.on("playlisted", (track: ITrack, playlist: Playlist) => {
			const endpoints = this.getComponents(Endpoint, preserver.tenant);

			endpoints.forEach(x => {
				x.sendTracks([track], playlist);
			});
		});
	}

	@handle(Scheduler)
	private onScheduler(scheduler: Scheduler): void {
		const aggregator = this.getComponent(Aggregator, scheduler.tenant);
		const preserver = this.getComponent(Preserver, scheduler.tenant);
		const endpoints = this.getComponents(Endpoint, scheduler.tenant);

		scheduler.on("triggered", async (selected?: string[]) => {
			const playlists = (await preserver.getPlaylists(true)).filter(
				x => !selected || selected.includes(x.title)
			);

			playlists.forEach(async playlist => {
				endpoints.forEach(x => x.clearPlaylist(playlist));
				const source = preserver.getTracks.bind(preserver);
				const tracks = await aggregator.recommend(
					source,
					playlist,
					async (tracks: ITrack[]): Promise<void> => {
						for (const endpoint of endpoints) {
							await endpoint.sendTracks(tracks, playlist);
						}
					}
				);

				log(
					`Playlist "${playlist.title}" updated with ${tracks.length} tracks.`
				);
			});
		});
	}
}
