import { log, LogType } from "../../common/utils.class";
import Provider from "./providers/provider.abstract";
import SoundCloudProvider from "./providers/soundcloud.provider";
import VKProvider from "./providers/vk.provider";
import YandexProvider from "./providers/yandex.provider";
import YouTubeProvider from "./providers/youtube.provider";
import { ITrack } from "./track.interface";

/**
 * Aggregates track data from all Amadeus' providers
 */
export default class Aggregator {
	private providers: Provider[] = [];
	private tokens: string[];
	private lastQuery: string | undefined;
	private lastTrack: ITrack | undefined;

	public constructor() {
		const providers = [
			VKProvider,
			YandexProvider,
			SoundCloudProvider,
			YouTubeProvider
		];

		this.tokens = [
			process.env["VK_TOKEN"] as string,
			process.env["YANDEX_TOKEN"] as string,
			process.env["SOUNDCLOUD_TOKEN"] as string,
			process.env["YOUTUBE_TOKEN"] as string
		];

		for (const i in providers) {
			const provider = new providers[i](this.tokens[i]);
			this.providers.push(provider);
		}
	}

	private equal(a: ITrack, b?: ITrack): boolean {
		if (!b) return false;
		return (
			a.title.toLowerCase().trim() == b.title.toLowerCase().trim() &&
			a.artists
				.sort()
				.join()
				.toLowerCase()
				.trim() ==
				b.artists
					.sort()
					.join()
					.toLowerCase()
					.trim()
		);
	}

	private filter(tracks: ITrack[], full: ITrack[] = tracks): ITrack[] {
		//Filter duplicates
		tracks = tracks.filter((value, index) => {
			return (
				full.findIndex(x => this.equal(x, value)) ===
				(full != tracks ? -1 : index)
			);
		});

		//Filter long
		tracks = tracks.filter(x => x.length < 1200);

		return tracks;
	}

	public async get(query: string): Promise<ITrack | null> {
		this.lastQuery = query;

		const promises = [];
		for (const i in this.providers) {
			const promise = this.providers[i].get(query, 1).catch(e => {
				log(
					`${this.providers[i].constructor.name} failed to load tracks!\n${e}`,
					LogType.ERROR
				);
				return [] as ITrack[];
			});

			promises.push(promise);
		}

		for (const promise of promises) {
			const track = this.filter(await promise)[0];
			if (track) {
				this.lastTrack = track;
				return track;
			}
		}

		this.lastTrack = undefined;
		return null;
	}

	public async more(
		callback?: (tracks: ITrack[]) => void
	): Promise<ITrack[]> {
		if (!this.lastQuery) return [];
		const limits = [6, 5, 2, 2];

		const tracks: ITrack[] = [];
		const promises = [];
		for (const i in this.providers) {
			if (!limits[i]) continue;
			const promise = this.providers[i]
				.get(this.lastQuery, limits[i])
				.then(x => {
					callback?.(
						this.filter(x, tracks).filter(
							x => !this.equal(x, this.lastTrack)
						)
					);
					tracks.push(...x);
				})
				.catch(() => {
					log(
						`${this.providers[i].constructor.name} failed to load tracks!`,
						LogType.ERROR
					);
				});

			promises.push(promise);
		}

		await Promise.all(promises);

		return this.filter(tracks).slice(1);
	}
}
