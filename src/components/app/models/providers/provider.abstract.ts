import { ITrack } from "../track.interface";
import fetch, { Response, RequestInit, RequestInfo } from "node-fetch";
import { log, LogType, sleep } from "../../../common/utils.class";

export default abstract class Provider {
	protected token: string;
	protected headers: Record<string, string> = {};
	protected params: Record<string, string> = {};
	protected abstract baseURL: string;
	private readonly maxRetries = 10;

	public constructor(token: string) {
		this.token = token;
	}

	protected parse(text: string): IParsed {
		const year = /\s*(^|[-[({【|♫—–/\\:])\s*([1-2][0-9]{3})\s*([-\])}】|♫—–/\\:]|$)/;
		const joins = /,|\bft.|\bfeat.|&|\+|\/|\bfeaturing|\bmed\b|\band\b/i;
		const artists = /(((?<=["|♫—\-–/\\:]\s*)|\()(\s*[^\s|"♫—\-–/\\:()][^|"♫—\-–/\\:()]*?)(\b(edit|rmx|remix|cover|version)\b\s*)+\)?)|([[({【]?(edited|rmx|remix|cover|performed)?\s*(\bby\b|\bft\.?|\bfeat\.?|\bfeaturing|\bmed\b)\s*(.*?)\s*([|♫—\-–/\\:\])}】](\s+|$)|$))/gi;
		const separators = /\s*["|♫—–\\:]+\s*|\s*[-/]+\s+|\s+[-/]+\s*|(\W+|^)\.(\W+|$)/;
		const trim = /^['"`«»|♫—\-–/\\:\s]+|['"`«»|♫—\-–/\\:\s]+$/gi;
		const junk = [
			/[\s\-–_]+\s*[[({【]?\s*(of+icial\s+)?([PM]\/?V)\s*[\])}】]?/i, //MVs
			/\s*([({【][^)]*)?\bver(\.|sion)?(\s*[\])}】])?/i, //Versions
			/[[({【]?\s*(original\s*)?(of+icial\s*)?(music\s*)?(video|mix)(\s*[\])}】])?/i, //Official/music video
			/\s*(full\s*)?album\s*(tracks?)?/i, //Album
			/\s*[[({【]?\s*(with)?\s*\+(of+icial)?\s*lyrics?\s*(video)?\s*([\])}】]|$)/i, //Lyrics
			/\s*[[({【]\s*(HD|HQ|[0-9]{3,4}p|4K)\s*(version|video|quality)?\s*[\])}】]/i, //Qulity
			/[\s\-–_♫]+(HD|HQ|[0-9]{3,4}(p|bpm)|4K)\s*(version|video|quality)?\s*/gi, //Quality 2
			/\s*\(?live\)?$/, //Live
			/\s*[[({【]?(music|audio|sound)\s+only(\s*[\])}】])?/i, //Audio
			/(free|download|(no)?\s*copyright|royalty)/gi, //Copyright
			/\bS[0-9]+E[0-9]+\b/i, //Episode
			/^\s*\[[^\]]+]\s*/g, //Stuff at the start
			/^\s*\([^)]+\)\s*/g, //Stuff at the start
			/^\s*\{[^}]+\}\s*/g, //Stuff at the start
			/\s*\[[^\]]+]\s*$/g, //Stuff at the end
			/\s*\([^)]+\)\s*$/g, //Stuff at the end
			/\s*\{[^}]+\}\s*$/g //Stuff at the end
		];

		const parsed: IParsed = { title: text, artists: [], album: "" };

		parsed.year = +(text.match(year)?.[2] || 0) || undefined;
		text = text.replace(year, "");

		const matches = (text as any).matchAll(artists);
		for (const match of matches) {
			parsed.artists.push(
				...((match?.[3] || match?.[9])?.split(joins) || [])
			);
		}
		text = text.replace(artists, "");
		junk.forEach(x => (text = text.replace(x, "")));

		const parts = text
			.split(separators)
			.filter(x => x?.replace(trim, ""))
			.map(x => x.replace(/((?<=^[^(]*[^:])\)$)|(\((?=[^)]*$))/g, ""));

		switch (parts.length) {
			case 0:
				parsed.title = text;
				break;
			case 1:
				parsed.title = parts[0];
				break;
			case 2:
				parsed.artists.push(...parts[0].split(joins));
				parsed.title = parts[1];
				break;
			default:
				parsed.artists.push(...parts[0].split(joins));
				parsed.title = parts.slice(1, parts.length - 1).join(" - ");
				parsed.album = parts[parts.length - 1];
				break;
		}

		parsed.title = parsed.title.replace(trim, "");
		parsed.album = parsed.album?.replace(trim, "") || parsed.title;
		parsed.artists = parsed.artists
			.map(x => x.replace(trim, ""))
			.filter(x => x);

		return parsed;
	}

	protected fetch(url: RequestInfo, params?: RequestInit): Promise<Response> {
		let retries = 0;
		const doFetch = (resolve: Function, reject: Function): void => {
			if (retries > this.maxRetries) {
				log(
					`Request from ${this.constructor.name} to "${url}" rejected!`,
					LogType.ERROR
				);

				reject();
				return;
			}

			fetch(url, params)
				.then(x => {
					resolve(x);
				})
				.catch(async () => {
					log(
						`Request from ${
							this.constructor.name
						} to "${url}" failed (retry ${++retries})!`,
						LogType.WARNING
					);

					await sleep(500);
					doFetch(resolve, reject);
				});
		};

		return new Promise((resolve, reject) => {
			doFetch(resolve, reject);
		});
	}

	protected async update<T>(
		args: any[][],
		method: (...args: any) => Promise<T>,
		callback: (result: T, index: number) => void
	): Promise<void[]> {
		const updates: Promise<void>[] = [];
		for (const i in args) {
			const promise = method
				.bind(this)(...args[i])
				.then(x => {
					callback(x, +i);
				})
				.catch(e => {
					log(
						`${JSON.stringify(args[i])} skiped by ${
							this.constructor.name
						} (failed to load)!\n${e}`,
						LogType.WARNING
					);
				});

			updates.push(promise);
		}

		return Promise.all(updates);
	}

	protected call(
		method: string,
		params: Record<string, any> = {}
	): Promise<Response> {
		const url = new URL(this.baseURL + method);
		url.search = new URLSearchParams({
			...this.params,
			...params
		}).toString();

		return this.fetch(url, {
			headers: this.headers
		});
	}

	abstract get(
		query: string,
		count: number,
		offset?: number
	): Promise<ITrack[]>;

	abstract desource(source: string): Promise<string | null>;
}

export interface IParsed {
	title: string;
	artists: string[];
	album: string;
	year?: number;
}
