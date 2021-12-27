import { is } from "typescript-is";
import { VKTrack } from "../providers/vk.provider";
import Recommender from "./recommender.abstract";

/**
 * VK track recommender
 */
export default class VKRecommender extends Recommender {
  protected baseURL = "https://api.vk.com/method/";
  protected headers = {
    "User-Agent":
      "VKAndroidApp/5.52-4543 (Android 5.1.1; SDK 22; x86_64; unknown Android SDK built for x86_64; en; 320x240)",
  };
  protected params = {
    v: "5.131",
    access_token: this.token,
  };

  protected async assemble(source: string, count: number): Promise<string[]> {
    const tracks = await this.getSimilarTracks(source, count);
    return tracks.map((x) => `aggr://vk:${x.owner_id}_${x.id}`);
  }

  private async getSimilarTracks(
    track: string,
    limit: number
  ): Promise<VKTrack[]> {
    const escape = (str: string) => str.replace(/["\\]/g, "\\$&");

    const code = `
			var audio = API.audio.search({
				"q":"${escape(track)}","count":1
			}).items[0];
			
			var id = audio.owner_id + "_" + audio.id;
			
			return API.audio.getRecommendations({
				target_audio: id,
				count: ${+limit},
				shuffle: 1
			});
		`;

    const result = await this.call("execute", { code });
    if (!is<VKSimilar>(result)) return [];
    return result.response.items;
  }
}

interface VKSimilar {
  response: {
    items: VKTrack[];
  };
}
