import Application, { handle } from "../common/application.abstract";
import { log, wrn } from "../common/utils.class";
import Aggregator from "./controllers/aggregator.controller";
import { TrackPreview, stringify, Track } from "./models/track.interface";
import Preserver, { PlaylistUpdate } from "./controllers/preserver.controller";
import API from "./controllers/endpoints/api.endpoint";
import { Playlist } from "prisma/client/tenant";
import { first, generate } from "./models/generator";
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
      new SoundCloudProvider(token("SOUNDCLOUD")),
    ].filter((x) => (x as any).token);

    const recommenders = [
      new VKRecommender(token("VK")),
      new LastFMRecommender(token("LASTFM")),
      new YandexRecommender(token("YANDEX")),
    ].filter((x) => (x as any).token);

    const transcribers = [
      new GeniusTranscriber(),
      new YandexTranscriber(token("YANDEX")),
    ].filter((x) => (x as any).token);

    const recognizers = [
      new MidomiRecognizer(),
      new AudDRecognizer(token("AUDD")),
      new YandexRecognizer(),
    ].filter((x) => (x as any).token);

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

    endpoint.wants("similar", (query: string) => {
      log(`${name} queried similar to "${query}" from ${endpoint.name}.`);
      return aggregator.recommend([query]);
    });

    endpoint.wants("lyrics", (query: string) => {
      log(`${name} queried lyrics for "${query}" from ${endpoint.name}.`);
      return aggregator.transcribe(query);
    });

    endpoint.wants("recognise", (sample: string) => {
      log(`${name} queried audio recoginition from ${endpoint.name}.`);
      return aggregator.recognise(sample);
    });

    endpoint.wants("playlists", () => {
      log(`${name} requested playlists from ${endpoint.name}.`);
      return preserver.getPlaylists("all");
    });

    endpoint.wants("tracks", async (playlist?: number) => {
      const id = playlist || "*";
      log(`${name} listed playlist ${id} from ${endpoint.name}.`);
      return await preserver.getPlaylist(playlist);
    });

    endpoint.on("playlisted", async (track: Track, playlist: string) => {
      preserver.addTrack(track, playlist);
    });

    endpoint.on("relisted", (playlist: string, update: PlaylistUpdate) => {
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
    const endpoints = this.getComponents(Endpoint, preserver.tenant);
    const aggregator = this.getComponent(Aggregator);
    const name = preserver.tenant.identifier;

    preserver.on(
      "playlisted",
      async (track: Track, playlist: Playlist, manually: boolean) => {
        if (manually) {
          log(`${name} added track "${track.title}" to "${playlist.title}".`);
        }

        let preview: TrackPreview | undefined;
        if (typeof (track as any).load === "function") {
          preview = track as TrackPreview;
        } else {
          preview = await first(aggregator.desource(track.sources));
        }

        if (!preview) {
          wrn(`Unable to desource ${track.title}!`);
          return;
        }

        for (const endpoint of endpoints) {
          endpoint.add(generate(preview), playlist);
        }
      }
    );
  }

  @handle(Scheduler)
  private onScheduler(scheduler: Scheduler): void {
    const name = scheduler.tenant.identifier;
    const aggregator = this.getComponent(Aggregator);
    const preserver = this.getComponent(Preserver, scheduler.tenant);
    const endpoints = this.getComponents(Endpoint, scheduler.tenant);

    scheduler.on("triggered", async (selected?: string[]) => {
      const playlists = (await preserver.getPlaylists("dynamic")).filter(
        (x) => !selected || selected.includes(x.title)
      );

      playlists.forEach(async (playlist) => {
        const batch = scheduler.tenant.batch;
        //Wait until all the playlists are cleared
        await preserver.clearPlaylist(playlist.title);
        await Promise.all(endpoints.map((x) => x.clear(playlist)));
        //Get a sample of the last 100 user's tracks
        const str = (x: Track) => stringify(x);
        const sample = (await preserver.getPlaylist(undefined, 100)).map(str);
        //Recommendations are based on this sample
        const tracks = aggregator.recommend(sample, batch, playlist.type === 2);

        //Save every track
        for await (const track of tracks) {
          preserver.addTrack(track, playlist.title, false);
        }

        log(`${name}'s playlist "${playlist.title}" updated with new tracks.`);
      });
    });
  }
}
