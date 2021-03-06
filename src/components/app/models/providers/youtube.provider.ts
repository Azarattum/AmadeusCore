/* eslint-disable @typescript-eslint/camelcase */
import fetch from "node-fetch";
import { format, log, LogType } from "../../../common/utils.class";
import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";

export default class YouTubeProvider extends Provider {
	protected baseURL = "https://youtube.googleapis.com/youtube/v3/";
	protected params = {
		key: this.token
	};

	/**Player decryption cache */
	private playerCache: Map<string, Function> = new Map();

	private async search(query: string, count = 1): Promise<ITrackYouTube[]> {
		const response = await this.call("search", {
			part: "snippet",
			q: query,
			maxResults: count,
			type: "video"
		});
		const json = await response.json();

		return json.items;
	}

	private parseInfo(info: string): any {
		return info
			.split("&")
			.reduce((params: Record<string, string>, param: string) => {
				const paramSplit = param.split("=").map(function(value: any) {
					return decodeURIComponent(value.replace("+", " "));
				});

				params[paramSplit[0]] = paramSplit[1];
				return params;
			}, {});
	}

	private parseString(text: string): string {
		const map = {
			"&amp;": "&",
			"&lt;": "<",
			"&gt;": ">",
			"&quot;": '"',
			"&#039;": "'",
			"&#39;": "'"
		};
		return text.replace(/&amp;|&lt;|&gt;|&quot;|&#039;|&#39;/g, m => {
			return (map as any)[m];
		});
	}

	private parseTitle(text: string, channel: string): [string, string[]] {
		const joins = /,|(\s(ft.|feat.|&|\+|\/|featuring|med)\s)/;
		let title = text;
		let artists = channel;

		if (text.includes(" - ")) {
			[artists, title] = text.split(" - ");
		}
		if (text.includes(" | ")) {
			[artists, title] = text.split(" | ");
		}
		if (text.includes(" by ")) {
			[title, artists] = text.split(" by ");
		}

		return [title, artists.split(joins).map(x => x.trim())];
	}

	private async decryptSignature(
		sig: string,
		playerUrl: string
	): Promise<string> {
		//Format URL
		if (playerUrl.startsWith("//")) {
			playerUrl = "https:" + playerUrl;
		} else if (!playerUrl.match(/https?:\/\//)) {
			playerUrl = new URL(playerUrl, "https://www.youtube.com").href;
		}

		//Load from cache if available
		if (this.playerCache.has(playerUrl)) {
			return this.playerCache.get(playerUrl)?.(sig);
		}

		//Load player script
		const player = await (await fetch(playerUrl)).text();

		//Search for decrypt function name
		const funcRegexes = [
			new RegExp(
				String.raw`\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\s*\(\s*(?<sig>[a-zA-Z0-9$]+)\(`
			),
			new RegExp(
				String.raw`\b[a-zA-Z0-9]+\s*&&\s*[a-zA-Z0-9]+\.set\([^,]+\s*,\s*encodeURIComponent\s*\(\s*(?<sig>[a-zA-Z0-9$]+)\(`
			),
			new RegExp(
				String.raw`\bm=(?<sig>[a-zA-Z0-9$]{2})\(decodeURIComponent\(h\.s\)\)`
			),
			new RegExp(
				String.raw`\bc&&\(c=(?<sig>[a-zA-Z0-9$]{2})\(decodeURIComponent\(c\)\)`
			),
			new RegExp(
				String.raw`(?:\b|[^a-zA-Z0-9$])(?<sig>[a-zA-Z0-9$]{2})\s*=\s*function\(\s*a\s*\)\s*{\s*a\s*=\s*a\.split\(\s*""\s*\);[a-zA-Z0-9$]{2}\.[a-zA-Z0-9$]{2}\(a,\d+\)`
			),
			new RegExp(
				String.raw`(?:\b|[^a-zA-Z0-9$])(?<sig>[a-zA-Z0-9$]{2})\s*=\s*function\(\s*a\s*\)\s*{\s*a\s*=\s*a\.split\(\s*""\s*\)`
			),
			new RegExp(
				String.raw`(?<sig>[a-zA-Z0-9$]+)\s*=\s*function\(\s*a\s*\)\s*{\s*a\s*=\s*a\.split\(\s*""\s*\)`
			)
		];

		let func = "";
		for (const regex of funcRegexes) {
			func = player.match(regex)?.groups?.["sig"] || "";
			if (func) break;
		}
		if (!func) {
			log(
				"Failed to find decrypt function name in YouTube player script!",
				LogType.ERROR
			);
			return "";
		}

		//Search for decrypt function implementation
		const codeRegex = new RegExp(
			format(
				String.raw`(?:function\s+{0}|[{;,]\s*{0}\s*=\s*function|var\s+{0}\s*=\s*function)\s*\((?<args>[^)]*)\)\s*\{(?<code>[^}]+)\}`,
				func
			)
		);

		const match = player.match(codeRegex);
		if (!match) {
			log(
				"Failed to find decrypt function in YouTube player script!",
				LogType.ERROR
			);
			return "";
		}
		const { args, code } = match.groups || {};

		let wrapped = `const decrypt = (${args}) => {${code}};decrypt`;

		//Try fix function dependencies
		for (let i = 0; i < 100; i++) {
			const undef = eval(
				`let message; try{${wrapped}("")}catch(e){message=e.message}; message`
			)?.split(" ")?.[0];

			if (!undef) break;

			const defRegex = new RegExp(`${undef}\\s*=\\s*{([^;]|;[^}])+?};`);
			wrapped = "const " + (player.match(defRegex)?.[0] || "") + wrapped;
		}

		try {
			this.playerCache.set(playerUrl, eval(wrapped));
		} catch {
			log(
				"Failed to build decryption function for YouTube player!",
				LogType.ERROR
			);
			return "";
		}
		return this.playerCache.get(playerUrl)?.(sig);
	}

	public async load(id: string): Promise<[string | null, string, number]> {
		const page = await fetch(`https://www.youtube.com/watch?v=${id}`);

		const text = await page.text();
		const playerRegex = /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/;
		const playerResponse = text.match(playerRegex)?.[1] || "{}";

		const player = JSON.parse(playerResponse);
		const formats = player?.streamingData?.adaptiveFormats;
		const thumbs = player?.videoDetails?.thumbnail?.thumbnails;
		const thumb = thumbs ? thumbs[thumbs.length - 1].url : "";

		if (!formats) {
			log(
				"Failed to get streaming formats for a YouTube video!",
				LogType.ERROR
			);
			return [null, "", 0];
		}

		const audio = formats
			.filter((x: any) => x.audioQuality)
			.sort((a: any, b: any) => b.bitrate - a.bitrate)[0];

		if (!audio.url) {
			const info = this.parseInfo(audio.signatureCipher);
			const url = info.url;

			const urlRegex = /"(?:PLAYER_JS_URL|jsUrl)"\s*:\s*"([^"]+)"/;
			const playerUrl = text.match(urlRegex)?.[1] || "";
			const sig = await this.decryptSignature(info.s, playerUrl);
			if (!sig) {
				log(
					"Failed to decrypt signature while loading a YouTube video!",
					LogType.ERROR
				);
				return [null, "", 0];
			}

			audio.url = url + "&" + info.sp + "=" + sig;
		}

		return [audio.url, thumb, +audio.approxDurationMs / 1000];
	}

	public async get(query: string, count = 1): Promise<ITrack[]> {
		const tracks = await this.search(query, count);

		const metas = tracks.map(x => {
			const [title, artists] = this.parseTitle(
				this.parseString(x.snippet.title),
				this.parseString(x.snippet.channelTitle)
			);

			return {
				title: title,
				artists: artists,
				album: this.parseString(x.snippet.channelTitle),
				length: 0,
				year: new Date(x.snippet.publishedAt).getFullYear(),
				cover: x.snippet.thumbnails.high.url,
				url: null
			};
		}) as ITrack[];

		const loads: Promise<any>[] = [];
		for (const i in tracks) {
			const promise = this.load(tracks[i].id.videoId).then(x => {
				metas[i].url = x[0];
				metas[i].cover = x[1] || metas[i].cover;
				metas[i].length = x[2];
			});

			loads.push(promise);
		}

		await Promise.all(loads);

		console.log(metas.filter(x => x.url));
		return metas.filter(x => x.url);
	}
}

interface ITrackYouTube {
	kind: string;
	etag: string;
	id: { kind: string; videoId: string };
	snippet: ISnippetYouTube;
}

interface ISnippetYouTube {
	publishedAt: string;
	channelId: string;
	title: string;
	description: string;
	thumbnails: IThumbnailsYouTube;
	channelTitle: string;
	liveBroadcastContent: string;
	publishTime: string;
}

interface IThumbnailsYouTube {
	default: IThumbnailYouTube;
	medium: IThumbnailYouTube;
	high: IThumbnailYouTube;
}

interface IThumbnailYouTube {
	url: string;
	width: number;
	height: number;
}
