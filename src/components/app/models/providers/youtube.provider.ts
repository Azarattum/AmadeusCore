import { TrackPreview } from "../track.interface";
import Provider from "./provider.abstract";
import ytsr, { ContinueResult } from "ytsr";
import ytdl from "ytdl-core";
import parse, { parseArtists } from "../parser";
import { is } from "typescript-is";
import ytpl from "ytpl";

export default class YouTubeProvider extends Provider<YouTubeTrack> {
  public async *identify(source: string): AsyncGenerator<YouTubeTrack> {
    //Source check
    if (source.match(/aggr:\/\/(?!youtube:)/)) return;
    //From aggregator
    if (source.startsWith("aggr://youtube:")) source = source.slice(15);

    //Video url
    try {
      const info = await ytdl.getBasicInfo(source);
      const details = info.player_response.videoDetails;
      const thumb = details.thumbnail.thumbnails.reduce(function (a, b) {
        return a.height > b.height ? a : b;
      });

      const track: YouTubeTrack = {
        id: details.videoId,
        title: details.title,
        author: { name: details.author },
        bestThumbnail: thumb,
        duration: details.lengthSeconds,
      };

      yield track;
      return;
    } catch {
      //Not video
    }

    //Playlist/Channel url
    try {
      let playlist = (await ytpl(source)) as ytpl.ContinueResult;
      const tracks = playlist.items;

      for await (const track of tracks) {
        if (is<YouTubeTrack>(track)) yield track;
      }

      while (playlist.continuation) {
        playlist = await ytpl.continueReq(playlist.continuation);
        for await (const track of playlist.items) {
          if (is<YouTubeTrack>(track)) yield track;
        }
      }
    } catch {
      //Not playlist or channel
    }
  }

  protected async *search(query: string): AsyncGenerator<YouTubeTrack> {
    let response = (await ytsr(query, { pages: 1 })) as ContinueResult;
    const tracks = response.items;

    for await (const track of tracks) {
      if (track.type !== "video") continue;
      if (is<YouTubeTrack>(track)) yield track;
    }

    while (response.continuation) {
      response = await ytsr.continueReq(response.continuation);
      for await (const track of response.items) {
        if (track.type !== "video") continue;
        if (is<YouTubeTrack>(track)) yield track;
      }
    }
  }

  protected async *artist(query: string): AsyncGenerator<YouTubeTrack> {
    //Not aplicable
  }

  protected async *album(query: string): AsyncGenerator<YouTubeTrack> {
    //Not aplicable
  }

  protected convert(track: YouTubeTrack): TrackPreview {
    const author = parseArtists(track.author?.name);
    const { title, artists, year, album } = parse(track.title);

    const converted = {
      title: title,
      artists: artists.length ? artists : author,
      album: album,
      length: +track.duration
        .split(":")
        .reduce((acc, time) => 60 * +acc + +time + ""),
      year: year,
      cover: track?.bestThumbnail?.url || undefined,
      url: undefined as any,
      sources: [`aggr://youtube:${track.id}`],
    };

    return {
      title: converted.title,
      artists: converted.artists,
      album: converted.album,
      cover: converted.cover,
      sources: converted.sources,
      length: converted.length,

      load: async () => {
        const [url, cover, date] = await this.load(track.id);

        converted.url = url;
        converted.cover = cover || converted.cover;
        converted.year = converted.year || date;

        return converted;
      },
    };
  }

  protected validate(track: YouTubeTrack): boolean {
    const length = +track.duration
      .split(":")
      .reduce((acc, time) => 60 * +acc + +time + "");

    if (length > 600) return false;
    return true;
  }

  private async load(id: string): Promise<[string, string, number?]> {
    const info = await ytdl.getInfo(id);
    const player = info.player_response;

    const audio = ytdl.filterFormats(info.formats, "audioonly");

    let format;
    try {
      format = ytdl.chooseFormat(audio, {
        quality: "highestaudio",
        filter: (x) => x.audioCodec?.startsWith("mp4a") || false,
      });
    } catch {
      format = ytdl.chooseFormat(audio, {
        quality: "highestaudio",
        filter: (x) => x.audioCodec?.startsWith("opus") || false,
      });
    }

    const thumb = info.videoDetails.thumbnails.reduce(function (a, b) {
      return a.height > b.height ? a : b;
    });
    const year =
      new Date(
        player.microformat.playerMicroformatRenderer.uploadDate
      ).getFullYear() || undefined;

    return [format.url, thumb.url, year];
  }
}

interface YouTubeTrack {
  id: string;
  title: string;
  duration: string;
  author?: { name: string };
  bestThumbnail?: { url: string };
}
