import Application, { handle } from "../common/application.abstract";
import { log } from "../common/utils.class";
import Aggregator from "./controllers/aggregator.controller";
import { ITrackPreview, ITrackInfo } from "./models/track.interface";
import Preserver, { IPlaylistUpdate } from "./controllers/preserver.controller";
import API from "./controllers/endpoints/api.endpoint";
import { Playlist } from "prisma/client/tenant";
import { clonable, generate } from "./models/generator";
import { TrackSource } from "./models/providers/provider.abstract";
import Telegram from "./controllers/endpoints/telegram.endpoint";
import Endpoint from "./controllers/endpoints/endpoint.abstract";
import Scheduler from "./controllers/scheduler.controller";
import YandexProvider from "./models/providers/yandex.provider";
import VKProvider from "./models/providers/vk.provider";
import SoundCloudProvider from "./models/providers/soundcloud.provider";
import YouTubeProvider from "./models/providers/youtube.provider";
import LastFMRecommender from "./models/recommenders/lastfm.recommender";
import VKRecommender from "./models/recommenders/vk.recommender";
import YandexRecommender from "./models/recommenders/yandex.recommender";
import GeniusTranscriber from "./models/transcribers/genius.transcriber";
import YandexTranscriber from "./models/transcribers/yandex.transcriber";
import AudDRecognizer from "./models/recognizers/audd.recognizer";
import YandexRecognizer from "./models/recognizers/yandex.recognizer";
import MidomiRecognizer from "./models/recognizers/midomi.recognizer";
import parse from "./models/parser";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Aggregator, Preserver, Scheduler, Telegram, API]);
	}

	/**
	 * Initializes the app
	 */
	public async initialize(): Promise<void> {
		const token = (name: string) => process.env[`${name}_TOKEN`] || "";

		const providers = [
			new VKProvider(token("VK")),
			new YandexProvider(token("YANDEX")),
			new YouTubeProvider(),
			new SoundCloudProvider(token("SOUNDCLOUD"))
		].filter(x => (x as any).token);

		const recommenders = [
			new VKRecommender(token("VK")),
			new LastFMRecommender(token("LASTFM")),
			new YandexRecommender(token("YANDEX"))
		].filter(x => (x as any).token);

		const transcribers = [
			new GeniusTranscriber(),
			new YandexTranscriber(token("YANDEX"))
		].filter(x => (x as any).token);

		const recognizers = [
			new MidomiRecognizer(),
			new AudDRecognizer(token("AUDD")),
			new YandexRecognizer()
		].filter(x => (x as any).token);

		await super.initialize(
			[Telegram, token("BOT")],
			[Aggregator, { providers, recommenders, transcribers, recognizers }]
		);
	}

	@handle(Endpoint)
	private onEndpoint(endpoint: Endpoint): void {
		const name = endpoint.tenant.identifier;
		const aggregator = this.getComponent(Aggregator);
		const preserver = this.getComponent(Preserver, endpoint.tenant);
		const scheduler = this.getComponent(Scheduler, endpoint.tenant);

		endpoint.wants("query", (query: string, from: TrackSource) => {
			log(`${name} queried ${from} "${query}" from ${endpoint.name}.`);
			return aggregator.get(query, from);
		});

		endpoint.wants("similar", (track: ITrackInfo) => {
			const title = [track.artists.join(", "), track.title]
				.filter(x => x)
				.join(" - ");

			log(`${name} queried similar to "${title}" from ${endpoint.name}.`);
			return aggregator.recommend([track]);
		});

		endpoint.wants("lyrics", (track: ITrackInfo | string) => {
			if (typeof track === "string") track = parse(track);
			const title = [track.artists.join(", "), track.title]
				.filter(x => x)
				.join(" - ");

			log(`${name} queried lyrics for "${title}" from ${endpoint.name}.`);
			return aggregator.transcribe(track);
		});

		endpoint.wants("recognise", (sample: string) => {
			log(`${name} queried audio recoginition from ${endpoint.name}.`);
			return aggregator.recognise(sample);
		});

		endpoint.wants("playlists", () => {
			log(`${name} requested playlists from ${endpoint.name}.`);
			return preserver.getPlaylists();
		});

		endpoint.wants("tracks", async (playlist?: number) => {
			const id = playlist || "*";
			log(`${name} listed playlist ${id} from ${endpoint.name}.`);
			return await preserver.getPlaylist(playlist);
		});

		endpoint.on(
			"playlisted",
			async (track: ITrackPreview, playlist: string) => {
				preserver.addTrack(track, playlist);
			}
		);

		endpoint.on("relisted", (playlist: string, update: IPlaylistUpdate) => {
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
		const name = preserver.tenant.identifier;

		preserver.on(
			"playlisted",
			(track: ITrackPreview, playlist: Playlist) => {
				log(
					`${name} added track "${track.title}" to "${playlist.title}".`
				);
				const endpoints = this.getComponents(
					Endpoint,
					preserver.tenant
				);

				endpoints.forEach(x => {
					x.add(generate(track), playlist);
				});
			}
		);
	}

	@handle(Scheduler)
	private onScheduler(scheduler: Scheduler): void {
		const aggregator = this.getComponent(Aggregator);
		const preserver = this.getComponent(Preserver, scheduler.tenant);
		const endpoints = this.getComponents(Endpoint, scheduler.tenant);

		scheduler.on("triggered", async (selected?: string[]) => {
			const playlists = (await preserver.getPlaylists(true)).filter(
				x => !selected || selected.includes(x.title)
			);

			playlists.forEach(async playlist => {
				const batch = scheduler.tenant.batch;
				//Wait until all the playlists are cleared
				await Promise.all(endpoints.map(x => x.clear(playlist)));
				//Get a sample of the last 100 user's tracks
				const sample = await preserver.getTracks(100);
				//Recommendations are based on this sample
				const tracks = clonable(
					aggregator.recommend(sample, batch, playlist.type === 2)
				);

				//Send new tracks to every endpoint
				for (const endpoint of endpoints) {
					await endpoint.add(tracks.clone(), playlist);
				}

				log(`Playlist "${playlist.title}" updated with new tracks.`);
			});
		});
	}
}
