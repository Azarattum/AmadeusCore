import Application, { handle } from "../common/application.abstract";
import { log } from "../common/utils.class";
import Aggregator from "./controllers/aggregator.controller";
import { ITrack } from "./models/track.interface";
import Preserver from "./controllers/preserver.controller";
import Tenant from "./models/tenant";
import { Playlist } from "@prisma/client";
import Telegram from "./controllers/endpoints/telegram.endpoint";
import Endpoint from "./controllers/endpoints/endpoint.abstract";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Aggregator, Preserver, Telegram]);
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
					youTube: process.env["YOUTUBE_TOKEN"]
				}
			]
		);
	}

	@handle(Endpoint)
	private onEndpoint(endpoint: Endpoint): void {
		const name = endpoint.tenant.identifier;
		const aggregator = this.getComponent(Aggregator, endpoint.tenant);
		const preserver = this.getComponent(Preserver, endpoint.tenant);

		endpoint.on("searched", async (query: string) => {
			log(`${name} searched for "${query}"...`);

			const track = await aggregator.single(query);
			if (!track) return;
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

			preserver.playlistTrack(track, playlist);
		});

		endpoint.on("relist", (playlist: string, id: number) => {
			log(`"${playlist}" relisted as "${id}".`);

			preserver.updatePlaylist(playlist, id);
		});
	}

	@handle(Preserver)
	private onPreserver(preserver: Preserver): void {
		preserver.on(
			"playlisted",
			(tenant: Tenant, track: ITrack, playlist: Playlist) => {
				const endpoints = this.getComponents(Endpoint, tenant);

				endpoints.forEach(x => {
					x.playlistTrack(track, playlist);
				});
			}
		);
	}
}
