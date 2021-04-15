import Aggregator from "../../../app/controllers/aggregator.controller";
import Provider from "../../../app/models/providers/provider.abstract";
import Recommender, {
	ITrackInfo
} from "../../../app/models/recommenders/recommender.abstract";
import { ITrack } from "../../../app/models/track.interface";

class TestProvider extends Provider {
	protected baseURL: string = "";
	protected async convert(track: any): Promise<ITrack | { url: undefined }> {
		const data = track + "";
		return {
			title: data,
			album: data,
			artists: [data],
			length: 0,
			sources: [data],
			url: data
		};
	}
	protected async *identify(
		source: string
	): AsyncGenerator<any, any, unknown> {
		yield source;
	}
	protected async *search(query: string): AsyncGenerator<any, any, unknown> {
		yield query;
	}
}

class TestRecommender extends Recommender {
	protected async assemble(source: ITrackInfo[]): Promise<string[]> {
		return ["recommended"];
	}
}

const aggr = new Aggregator();
aggr.initialize([new TestProvider()], [new TestRecommender()]);

describe("Aggregator", () => {
	it("get", async () => {
		const tracks = aggr.get("test");
		const any = jest.fn();
		for await (const track of tracks) {
			expect(track).toEqual({
				title: "test",
				album: "test",
				artists: ["test"],
				length: 0,
				sources: ["test"],
				url: "test"
			});
			any();
		}

		expect(any).toHaveBeenCalledTimes(1);
	});

	it("desource", async () => {
		const tracks = aggr.desource(["42"]);
		const any = jest.fn();
		for await (const track of tracks) {
			expect(track).toEqual({
				title: "42",
				album: "42",
				artists: ["42"],
				length: 0,
				sources: ["42"],
				url: "42"
			});
			any();
		}

		expect(any).toHaveBeenCalledTimes(1);
	});

	it("recommend", async () => {
		const tracks = aggr.recommend([]);
		const any = jest.fn();
		for await (const track of tracks) {
			expect(track).toEqual({
				title: "recommended",
				album: "recommended",
				artists: ["recommended"],
				length: 0,
				sources: ["recommended"],
				url: "recommended"
			});
			any();
		}

		expect(any).toHaveBeenCalledTimes(1);
	});
});