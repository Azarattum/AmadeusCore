import { gretch } from "gretchen";
import { assertType } from "typescript-is";
import { ITrackInfo } from "../track.interface";
import { load } from "cheerio";
import Transcriber from "./transcriber.abstract";

/**
 * Genius lyrics transcriber
 */
export default class GeniusTranscriber extends Transcriber {
	protected baseURL = "https://genius.com/api/";

	public async assemble(source: ITrackInfo): Promise<string | null> {
		const result = await this.call("search", {
			per_page: 1,
			q: this.optimize(source)
		});

		const match = assertType<ISearchResult>(result).response.hits.filter(
			x => x.type === "song"
		)[0]?.result;
		if (!match?.url) return null;
		if (match.lyrics_state !== "complete") return null;

		const { data: text, status } = await gretch(match.url).text();
		if (status !== 200) return null;
		const lyrics = this.extract(text);

		return lyrics;
	}

	private extract(page: string): string {
		const $ = load(page);
		let lyrics = $(".lyrics").text().trim();
		if (!lyrics) {
			lyrics = "";
			$('div[class^="Lyrics__Container"]').each((i, elem) => {
				if (elem && $(elem).text().length !== 0) {
					const snippet = $(elem)
						.html()
						?.replace(/<br>/g, "\n")
						.replace(/<(?!\s*br\s*\/?)[^>]+>/gi, "");
					if (!snippet) return;

					lyrics +=
						$("<textarea/>").html(snippet).text().trim() + "\n\n";
				}
			});
		}

		return lyrics.replace(/\n\n\n+/g, "\n\n").trim();
	}

	private optimize(track: ITrackInfo): string {
		return `${track.title} ${track.artists.sort().join()}`
			.toLowerCase()
			.replace(/ *\([^)]*\) */g, " ")
			.replace(/ *\[[^\]]*]/, " ")
			.replace(/feat.|ft./g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
}

interface ISearchResult {
	response: {
		hits: {
			type: string;
			result: {
				url: string;
				lyrics_state: string;
			};
		}[];
	};
}
