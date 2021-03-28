import { format, log, LogType } from "../../../common/utils.class";
import { ITrack } from "../track.interface";
import Provider from "./provider.abstract";
import ytsr, { ContinueResult, Video } from "ytsr";

export default class YouTubeProvider extends Provider {
	/**Player decryption cache */
	private playerCache: Map<string, Function> = new Map();
	protected baseURL = "";

	public constructor() {
		super("");
	}

	private async search(
		query: string,
		count = 1,
		offset = 0
	): Promise<Video[]> {
		let response = (await ytsr(query, {
			pages: 1
		})) as ContinueResult;
		const items = response.items.filter(x => x.type === "video");

		while (response.continuation && items.length < offset + count) {
			response = await ytsr.continueReq(response.continuation);
			items.push(...response.items.filter(x => x.type === "video"));
		}

		return items.slice(offset, offset + count) as Video[];
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

	public async load(
		id: string
	): Promise<[string | null, string, number, number | undefined]> {
		const page = await fetch(`https://www.youtube.com/watch?v=${id}`);

		const text = await page.text();
		const playerRegex = /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/;
		const playerResponse = text.match(playerRegex)?.[1] || "{}";

		const player = JSON.parse(playerResponse);

		const formats = player?.streamingData?.adaptiveFormats;
		const thumbs = player?.videoDetails?.thumbnail?.thumbnails;
		const thumb = thumbs ? thumbs[thumbs.length - 1].url : "";
		const year =
			new Date(
				player?.microformat?.playerMicroformatRenderer?.uploadDate
			).getFullYear() || undefined;

		if (!formats) {
			log(
				"Failed to get streaming formats for a YouTube video!",
				LogType.ERROR
			);
			return [null, "", 0, year];
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
				return [null, "", 0, year];
			}

			audio.url = url + "&" + info.sp + "=" + sig;
		}

		return [audio.url, thumb, +audio.approxDurationMs / 1000, year];
	}

	public async get(query: string, count = 1, offset = 0): Promise<ITrack[]> {
		const tracks = await this.search(query, count, offset);
		if (!tracks) return [];

		const metas = tracks.map(x => {
			const author = x.author ? [x.author.name] : [];
			const { title, artists, year, album } = this.parse(
				this.parseString(x.title)
			);

			return {
				title: title,
				artists: artists.length ? artists : author,
				album: album,
				length: 0,
				year: year,
				cover: x.bestThumbnail.url || undefined,
				url: null as any,
				sources: [`aggr://youtube:${x.id}`]
			};
		});

		await this.update(
			tracks.map(x => [x.id]),
			this.load,
			(x, i) => {
				metas[i].url = x[0];
				metas[i].cover = x[1] || metas[i].cover;
				metas[i].length = x[2];
				metas[i].year = metas[i].year || x[3];
			}
		);

		return metas.filter(x => x.url);
	}

	public async desource(source: string): Promise<string | null> {
		if (!source.startsWith("aggr://")) return null;
		source = source.replace("aggr://", "");
		if (!source.startsWith("youtube:")) return null;
		source = source.replace("youtube:", "");

		const [url] = await this.load(source);
		return url || null;
	}
}
