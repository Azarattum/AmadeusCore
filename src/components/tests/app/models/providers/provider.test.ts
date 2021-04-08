import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import Provider from "../../../../app/models/providers/provider.abstract";
import { ITrack } from "../../../../app/models/track.interface";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

class TestProvider extends Provider<any> {
	protected baseURL: string = "http://base";
	protected async *search(query: string): AsyncGenerator<any> {
		yield 1;
		throw 2;
		yield 3;
	}

	protected async *identify(source: string): AsyncGenerator<any> {
		yield await this.call("*");
	}
	protected async convert(track: any): Promise<ITrack> {
		return track;
	}
}

const provider = new TestProvider("token");

describe("Provider", () => {
	it("retry", async () => {
		let tried = false;
		fetchMock.get("*", () => {
			if (tried) return { url: "1" };
			tried = true;
			return 408;
		});

		expect((await provider.desource("").next()).value).toEqual({
			url: "1"
		});
		expect(fetchMock).toHaveFetchedTimes(2);
		expect(tried);

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("empty", async () => {
		let tried = false;
		fetchMock.get("*", () => {
			if (tried) return { url: "1" };
			tried = true;
			return 200;
		});

		expect((await provider.desource("").next()).value).toEqual({
			url: "1"
		});
		expect(fetchMock).toHaveFetchedTimes(2);
		expect(tried);

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("throw", async () => {
		const result = provider.get("");
		console.warn = jest.fn();

		await result.next();
		expect(console.warn).toHaveBeenCalled();
	});
});
