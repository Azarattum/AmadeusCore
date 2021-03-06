import { createHash } from "crypto";
import { gretch } from "gretchen";
import { assertType, is } from "typescript-is";
import { parseArtists } from "../parser";
import { TrackPreview } from "../track.interface";
import Provider from "./provider.abstract";

export default class YandexProvider extends Provider<YandexTrack> {
  protected baseURL = "https://api.music.yandex.net/";
  protected headers = {
    "User-Agent": "Yandex-Music-API",
    Authorization: `OAuth ${this.token}`,
  };

  protected async *identify(source: string): AsyncGenerator<YandexTrack> {
    let match;

    //From aggregator
    if (source.startsWith("aggr://yandex:")) {
      const audio = await this.call(`tracks/${source.slice(14)}`);
      const tracks = assertType<YandexSource>(audio).result;
      for (const track of tracks) yield track;

      return;
    }

    //From track url
    match = source.match(
      /(https?:\/\/)?music\.yandex\.ru\/album\/([0-9]+)\/track\/([0-9]+)/i
    );
    if (match) {
      const audios = await this.call(`tracks/${match[3]}`);
      const tracks = assertType<YandexSource>(audios).result;
      for (const track of tracks) yield track;

      return;
    }

    //From track album
    match = source.match(/(https?:\/\/)?music\.yandex\.ru\/album\/([0-9]+)/i);
    if (match) {
      const tracks = this.album(match[2]);
      for await (const track of tracks) yield track;
      return;
    }

    //From track artist
    match = source.match(/(https?:\/\/)?music\.yandex\.ru\/artist\/([0-9]+)/i);
    if (match) {
      const tracks = this.artist(match[2]);
      for await (const track of tracks) yield track;
      return;
    }

    //From playlist
    match = source.match(
      /(https?:\/\/)?music\.yandex\.ru\/users\/([a-z0-9_]+)\/playlists\/([0-9]+)/i
    );
    if (match) {
      const audios = await this.call(`users/${match[2]}/playlists/${match[3]}`);
      const tracks = assertType<YandexPlaylist>(audios).result.tracks;
      if (!tracks) return;
      for await (const track of tracks) yield track.track;

      return;
    }
  }

  protected async *search(query: string): AsyncGenerator<YandexTrack> {
    let tracks;
    let page = 0;
    do {
      const audios = await this.call("search", {
        type: "track",
        text: query,
        nococrrect: false,
        "page-size": 100,
        page: page++,
      });

      tracks = assertType<YandexSearch>(audios).result.tracks?.results;
      if (!tracks) return;
      for await (const track of tracks) {
        if (is<YandexTrack>(track)) yield track;
      }
    } while (tracks);
  }

  protected async *artist(query: string): AsyncGenerator<YandexTrack> {
    //Search for the artist
    if (query.match(/[^0-9]/)) {
      const artists = await this.call("search", {
        type: "artist",
        text: `"${query}"`,
        nococrrect: true,
        "page-size": 1,
        page: 0,
      });
      const id =
        assertType<YandexArtists>(artists).result.artists?.results[0]?.id;
      if (!id) return;
      query = id.toString();
    }

    //Fetch tracks
    let tracks;
    let page = 0;
    do {
      const audios = await this.call(`artists/${query}/tracks`, {
        "page-size": 100,
        page: page++,
      });
      tracks = assertType<YandexArtist>(audios).result.tracks;
      if (!tracks) return;
      for await (const track of tracks) yield track;
    } while (tracks);
  }

  protected async *album(query: string): AsyncGenerator<YandexTrack> {
    if (query.match(/[^0-9]/)) {
      const artists = await this.call("search", {
        type: "album",
        text: `"${query}"`,
        nococrrect: true,
        "page-size": 1,
        page: 0,
      });
      const id =
        assertType<YandexAlbums>(artists).result.albums?.results[0]?.id;
      if (!id) return;
      query = id.toString();
    }

    const audios = await this.call(`albums/${query}/with-tracks`);
    const tracks = assertType<YandexAlbum>(audios).result.volumes.flat();
    for (const track of tracks) yield track;
  }

  protected convert(track: YandexTrack): TrackPreview {
    const converted = {
      title: track.title,
      artists: parseArtists(track.artists.map((x) => x.name).join(", ")),
      album: track.albums[0]?.title || track.title,
      length: (track.durationMs || 0) / 1000,
      year: track.albums[0]?.year,
      cover: track.coverUri
        ? "https://" +
          track.coverUri.slice(0, track.coverUri.length - 2) +
          "800x800"
        : undefined,
      url: null as any,
      sources: [`aggr://yandex:${track.id}`],
    };

    return {
      title: converted.title,
      artists: converted.artists,
      album: converted.album,
      cover: converted.cover,
      sources: converted.sources,
      length: converted.length,

      load: async () => {
        converted.url = await this.load(track.id);
        return converted;
      },
    };
  }

  protected validate(track: YandexTrack): boolean {
    if (!track.durationMs) return false;
    if (track.durationMs > 1200 * 1000) return false;
    return true;
  }

  private async load(id: number | string): Promise<string> {
    const load = await this.call(`tracks/${id}/download-info`);

    const url =
      assertType<YandexDownload>(load).result[0].downloadInfoUrl +
      "&format=json";

    const { error, data } = await gretch(url).json();
    if (error) throw error;
    const info = assertType<YandexInfo>(data);

    const trackUrl = `XGRlBW9FXlekgbPrRHuSiA${info.path.substr(1)}${info.s}`;
    const sign = createHash("md5").update(trackUrl).digest("hex");

    return `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
  }
}

interface YandexInfo {
  path: string;
  host: string;
  s: string;
  ts: string;
}

interface YandexDownload {
  result: { downloadInfoUrl: string }[];
}

interface YandexAlbum {
  result: { volumes: YandexTrack[][] };
}

interface YandexAlbums {
  result: { albums?: { results: [{ id: number }] | [] } };
}

interface YandexArtist {
  result: { tracks?: YandexTrack[] };
}

interface YandexArtists {
  result: { artists?: { results: [{ id: number }] | [] } };
}

interface YandexPlaylist {
  result: { tracks: { track: YandexTrack }[] };
}

interface YandexSource {
  result: YandexTrack[];
}

interface YandexSearch {
  result: { tracks?: { results: unknown[] } };
}

interface YandexTrack {
  id: number | string;
  coverUri?: string;
  durationMs?: number;
  title: string;
  artists: { name: string }[];
  albums: {
    year?: number;
    title: string;
  }[];
}
