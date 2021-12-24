import { assertType, is } from "typescript-is";
import { sleep, wrn } from "../../../common/utils.class";
import { parseArtists } from "../parser";
import { ITrackPreview } from "../track.interface";
import Provider from "./provider.abstract";

export default class VKProvider extends Provider<ITrackVK> {
  protected baseURL = "https://api.vk.com/method/";
  protected headers = {
    "User-Agent":
      "VKAndroidApp/5.52-4543 (Android 5.1.1; SDK 22; x86_64; unknown Android SDK built for x86_64; en; 320x240)",
  };
  protected params = {
    v: "5.131",
    access_token: this.token,
  };

  protected async *identify(source: string): AsyncGenerator<ITrackVK> {
    let match;
    //From aggregator
    if (source.startsWith("aggr://vk:")) {
      const audios = await this.call("audio.getById", {
        audios: [source.slice(10)],
      });
      const tracks = assertType<ISourceVK>(audios).response;
      for (const track of tracks) yield track;

      return;
    }

    //From audio url
    match = source.match(/(https?:\/\/)?vk\.com\/audio(-?[0-9]+_[0-9]+)/i);
    if (match) {
      const audios = await this.call("audio.getById", {
        audios: [match[2]],
      });
      const tracks = assertType<ISourceVK>(audios).response;
      for (const track of tracks) yield track;

      return;
    }

    //From artist
    match = source.match(/(https?:\/\/)?vk\.com\/artist\/([a-z0-9_]+)/i);
    if (match) {
      const tracks = this.artist(match[2]);
      for await (const track of tracks) yield track;
      return;
    }

    //From playlist
    match = source.match(
      /(https?:\/\/)?vk\.com\/(?:music\?z=)?audio_playlist(-?[0-9]+)_([0-9]+)/i
    );
    if (match) {
      let tracks;
      let offset = 0;
      do {
        const audios = await this.call("audio.get", {
          owner_id: +match[2],
          album_id: +match[3],
          count: 100,
          offset: offset,
        });

        tracks = assertType<IResponseVK>(audios).response.items;
        for await (const track of tracks) yield track;
        offset += 100;
      } while (tracks.length);

      return;
    }

    //From user's page
    match = source.match(/(https?:\/\/)?vk\.com\/([a-z0-9_]+)/i);
    if (match) {
      const user = await this.call("users.get", {
        user_ids: [match[2]],
      });
      const id = assertType<IUserVK>(user).response[0].id;

      let tracks;
      let offset = 0;
      do {
        const audios = await this.call("audio.get", {
          owner_id: id,
          count: 100,
          offset: offset,
        });

        tracks = assertType<IResponseVK>(audios).response.items;
        for await (const track of tracks) yield track;
        offset += 100;
      } while (tracks.length);

      return;
    }
  }

  protected async *search(query: string): AsyncGenerator<ITrackVK> {
    let tracks = [];
    let retries = 0;
    let offset = 0;
    do {
      await sleep(3000 * retries);
      const audios = await this.call("audio.search", {
        q: query,
        count: 100,
        offset: offset,
      });

      if (this.capchaed(audios)) {
        retries++;
        continue;
      }

      tracks = assertType<IResponseVK>(audios).response.items;
      for await (const track of tracks) yield track;
      offset += 100;
    } while (tracks.length || (retries > 0 && retries < 3));
  }

  protected async *artist(query: string): AsyncGenerator<ITrackVK> {
    //Search for the artist
    if (query.match(/[^a-z0-9_]/)) {
      const artists = await this.call("audio.searchArtists", {
        q: query,
        count: 1,
      });
      query = assertType<IArtistVK>(artists).response.items[0]?.id || "";
      if (!query) return;
    }

    //Fetch tracks
    let tracks;
    let offset = 0;
    do {
      const audios = await this.call("audio.getAudiosByArtist", {
        artist_id: query,
        count: 100,
        offset: offset,
      });

      tracks = assertType<IResponseVK>(audios).response.items;
      for await (const track of tracks) yield track;
      offset += 100;
    } while (tracks.length);
  }

  protected async *album(query: string): AsyncGenerator<ITrackVK> {
    //Search for the album
    const artists = await this.call("audio.searchAlbums", {
      q: query,
      count: 1,
    });
    const album = assertType<IPlaylistVK>(artists).response.items[0];
    if (!album) return;
    const { id, owner_id } = album;

    //Fetch tracks
    let tracks;
    let offset = 0;
    do {
      const audios = await this.call("audio.get", {
        owner_id,
        album_id: id,
        count: 100,
        offset: offset,
      });

      tracks = assertType<IResponseVK>(audios).response.items;
      for await (const track of tracks) yield track;
      offset += 100;
    } while (tracks.length);
  }

  protected convert(track: ITrackVK): ITrackPreview {
    const converted = {
      title: track.title
        .replace(/(?<=\(([^)]+)\))\s+\(\1\)/g, "")
        .replace(/\s+\([a-z]+\s+Version\s*(\(.*\))?\s*\)\s*/i, ""),
      artists: parseArtists(track.artist),
      album: track.album?.title || track.title,
      length: track.duration,
      year: new Date(track.date * 1000).getFullYear(),
      cover: track.album?.thumb?.photo_1200,
      url: track.url,
      sources: [`aggr://vk:${track.owner_id}_${track.id}`],
    };

    return {
      title: converted.title,
      artists: converted.artists,
      album: converted.album,
      cover: converted.cover,
      source: converted.sources[0],

      track: async () => converted,
    };
  }

  protected validate(track: ITrackVK): boolean {
    if (track.duration > 1200) return false;
    return true;
  }

  private capchaed(res: any): boolean {
    if (!is<ICapchaVK>(res)) return false;
    const { error } = res as ICapchaVK;
    let cmd = 'curl -H "User-Agent: VKAndroidApp/5.52" "';
    cmd += "https://api.vk.com/method/audio.search?access_token=";
    cmd += this.token;
    cmd += `&v=5.71&q=&captcha_sid=${error.captcha_sid}&captcha_key=<KEY>"`;

    wrn(
      `VK Provider triggered a capcha!\nURL: ${error.captcha_img}\n` +
        `Use to mitigate:\n${cmd}`
    );

    return true;
  }
}

export interface ITrackVK {
  artist: string;
  id: number;
  owner_id: number;
  title: string;
  duration: number;
  url: string;
  date: number;
  album?: IAlbumVK;
}

interface IArtistVK {
  response: { items: [{ id: string }] | [] };
}

interface IPlaylistVK {
  response: {
    items: [{ id: number; owner_id: number }] | [];
  };
}

interface IUserVK {
  response: [{ id: number }];
}

interface ISourceVK {
  response: ITrackVK[];
}

interface IResponseVK {
  response: { items: ITrackVK[] };
}

interface IAlbumVK {
  title: string;
  thumb?: { photo_1200?: string };
}

interface ICapchaVK {
  error: {
    error_code: number;
    captcha_sid: string;
    captcha_img: string;
  };
}
