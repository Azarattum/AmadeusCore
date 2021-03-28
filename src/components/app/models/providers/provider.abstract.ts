import { ITrack } from "../track.interface";
import { log, LogType } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Provider extends Fetcher {
	public constructor(token: string) {
		super(token);
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
			/[[({【]?\s*(the)?\s*(original\s*)(video|mix|song)(\s*[\])}】])?/, //Original
			/\s*(full\s*)?album\s*(tracks?)?/i, //Album
			/\s*[[({【]?\s*(with)?\s*(of+icial)?\s*lyrics?\s*(video)?\s*([\])}】]|$)/i, //Lyrics
			/[[({【]?\s*(with|\+)?(\s*\S+)?\s*subtitles?\s*(in\s*\S+\s*)?[\])}】]?/i, //Subtitles
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
			/\s*\{[^}]+\}\s*$/g, //Stuff at the end
			/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF])/gi //Emoji
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
