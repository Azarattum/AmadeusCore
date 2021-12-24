import { is } from "typescript-is";
import { ITrackInfo } from "../track.interface";
import Recommender from "./recommender.abstract";

/**
 * Last FM track recommender
 */
export default class LastFMRecommender extends Recommender {
  protected baseURL = "https://ws.audioscrobbler.com/2.0/";
  protected params = {
    api_key: this.token,
    format: "json",
    autocorrect: "1",
  };

  protected async assemble(
    source: ITrackInfo,
    count: number
  ): Promise<string[]> {
    const similars = await this.getSimilarTracks(source, count);

    //Fallback to the artist similarity
    if (!similars.length && source.artists.length) {
      const artist = this.normalPick(source.artists)[0];
      const artists = await this.getSimilarArtists(artist, count);
      const chosen = this.normalPick(
        artists,
        Math.min(Math.ceil(count / 2), 20)
      );

      const perArtist = Math.ceil(count / chosen.length);
      const tracks = chosen.map((x) => this.getTopTracks(x, perArtist));
      similars.push(...(await Promise.all(tracks)).flat());
    }

    return similars;
  }

  private async getSimilarTracks(
    track: ITrackInfo,
    limit?: number
  ): Promise<string[]> {
    const result = await this.call("", {
      method: "track.getsimilar",
      track: track.title,
      artist: track.artists.join(", "),
      limit,
    });
    if (!is<ISimilarTracks>(result)) return [];
    const tracks = result.similartracks.track;

    return tracks.map((x) => {
      return [x.artist?.name, x.name].filter((x) => x).join(" - ");
    });
  }

  private async getSimilarArtists(
    artist: string,
    limit?: number
  ): Promise<string[]> {
    const result = await this.call("", {
      method: "artist.getsimilar",
      artist: artist,
      limit,
    });
    if (!is<ISimilarArtists>(result)) return [];
    const artists = result.similarartists.artist;

    return artists.map((x) => x.name);
  }

  private async getTopTracks(
    artist: string,
    limit?: number
  ): Promise<string[]> {
    const result = await this.call("", {
      method: "artist.gettoptracks",
      artist: artist,
      limit,
    });
    if (!is<ITopTracks>(result)) return [];
    const tracks = result.toptracks.track;

    return tracks.map((x) => {
      return [x.artist?.name, x.name].filter((x) => x).join(" - ");
    });
  }
}

interface ISimilarTracks {
  similartracks: {
    track: { artist?: { name: string } | null; name: string }[];
  };
}

interface ITopTracks {
  toptracks: {
    track: { artist?: { name: string } | null; name: string }[];
  };
}

interface ISimilarArtists {
  similarartists: {
    artist: { name: string }[];
  };
}
