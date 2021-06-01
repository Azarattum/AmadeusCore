import { is } from "typescript-is";
import { sleep } from "../../../common/utils.class";
import VKProvider, { ITrackVK } from "../providers/vk.provider";
import { IPreview, ITrackInfo, stringify } from "../track.interface";
import Recommender from "./recommender.abstract";

/**
 * VK track recommender
 */
export default class VKRecommender extends Recommender {
	private provider = (new VKProvider(this.token) as any) as IProvider;
	protected baseURL = "https://api.vk.com/method/";
	protected headers = {
		"User-Agent":
			"VKAndroidApp/5.52-4543 (Android 5.1.1; SDK 22; x86_64; unknown Android SDK built for x86_64; en; 320x240)"
	};
	protected params = {
		v: "5.71",
		access_token: this.token
	};

	protected async assemble(
		source: ITrackInfo,
		count: number
	): Promise<IPreview[]> {
		//Throttle to avoid captcha
		await sleep(100 * Math.random() + 1500);
		const audios = this.provider.search(stringify(source));
		const target = (await audios.next()).value as ITrackVK;
		if (!target) return [];
		const id = `${target.owner_id}_${target.id}`;

		const tracks = await this.getSimilarTracks(id, count);
		return tracks.map(x => this.provider.convert(x));
	}

	private async getSimilarTracks(
		id: string,
		limit?: number
	): Promise<ITrackVK[]> {
		const result = await this.call("audio.getRecommendations", {
			target_audio: id,
			count: limit,
			shuffle: 1
		});

		if (!is<ISimilarTracks>(result)) return [];
		return result.response.items;
	}
}

interface IProvider {
	search(query: string): AsyncGenerator<ITrackVK>;
	convert(track: ITrackVK): IPreview;
}

interface ISimilarTracks {
	response: {
		items: ITrackVK[];
	};
}
