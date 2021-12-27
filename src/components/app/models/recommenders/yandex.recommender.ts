import { is } from "typescript-is";
import Recommender from "./recommender.abstract";

/**
 * Yandex track recommender
 */
export default class YandexRecommender extends Recommender {
  protected baseURL = "https://api.music.yandex.net/";
  protected headers = {
    "User-Agent": "Yandex-Music-API",
    Authorization: `OAuth ${this.token}`,
  };

  protected async assemble(source: string, count: number): Promise<string[]> {
    //Search for the track
    const response = (await this.call("search", {
      type: "track",
      text: source,
      nococrrect: true,
      "page-size": 1,
      page: 0,
    })) as any;
    const track = +response?.result?.tracks?.results?.[0]?.id;
    if (!track) return [];

    //Find similar
    return (await this.getSimilarTracks(track)).slice(0, count);
  }

  private async getSimilarTracks(id: number): Promise<string[]> {
    const result = (await this.call(`tracks/${id}/similar`)) as YandexSimilar;

    if (!is<YandexSimilar>(result)) return [];
    const similar = result.result.similarTracks;

    return similar.map((x) => `aggr://yandex:${x.id}`);
  }
}

interface YandexSimilar {
  result: {
    similarTracks: {
      id: string;
    }[];
  };
}
