import { is } from "typescript-is";
import parse from "../parser";
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

  protected async assemble(source: string, count: number): Promise<string[]> {
    const { title, artists } = parse(source);
    const similars = await this.getSimilarTracks({ title, artists }, count);

    //Fallback to the artist similarity
    if (!similars.length && artists.length) {
      const artist = this.normalPick(artists)[0];
      const similar = await this.getSimilarArtists(artist, count);
      const chosen = this.normalPick(
        similar,
        Math.min(Math.ceil(count / 2), 20)
      );

      const perArtist = Math.ceil(count / chosen.length);
      const tracks = chosen.map((x) => this.getTopTracks(x, perArtist));
      similars.push(...(await Promise.all(tracks)).flat());
    }

    return similars;
  }

  private async getSimilarTracks(
    { title, artists }: { title: string; artists: string[] },
    limit?: number
  ): Promise<string[]> {
    const result = await this.call("", {
      method: "track.getsimilar",
      track: title,
      artist: artists.join(", "),
      limit,
    });
    if (!is<SimilarTracks>(result)) return [];
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
    if (!is<SimilarArtists>(result)) return [];
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
    if (!is<TopTracks>(result)) return [];
    const tracks = result.toptracks.track;

    return tracks.map((x) => {
      return [x.artist?.name, x.name].filter((x) => x).join(" - ");
    });
  }
}

interface SimilarTracks {
  similartracks: {
    track: { artist?: { name: string } | null; name: string }[];
  };
}

interface SimilarArtists {
  similarartists: {
    artist: { name: string }[];
  };
}

interface TopTracks {
  toptracks: {
    track: { artist?: { name: string } | null; name: string }[];
  };
}
