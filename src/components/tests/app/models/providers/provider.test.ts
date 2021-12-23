import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import Provider from "../../../../app/models/providers/provider.abstract";
import { ITrackPreview } from "../../../../app/models/track.interface";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

class TestProvider extends Provider<any> {
	protected baseURL: string = "http://base";
	protected async *search(query: string): AsyncGenerator<any> {
		yield 1;
		throw 2;
		yield 3;
	}
	protected async *artist(query: string): AsyncGenerator<any> {
		yield 42;
	}

	protected async *album(query: string): AsyncGenerator<any> {
		yield 1337;
	}

	protected async *identify(source: string): AsyncGenerator<any> {
		yield await this.call("*");
	}

	protected convert(track: any): ITrackPreview {
		return track;
	}
}

const provider = new TestProvider();

describe("Provider", () => {
	it("retry", async () => {
		let tried = false;
		fetchMock.get("*", () => {
			if (tried) return { url: "1" };
			tried = true;
			return 408;
		});

		expect((await provider.get("", "source").next()).value).toEqual({
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

		expect((await provider.get("", "source").next()).value).toEqual({
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

		expect((await result.next()).value).toBe(1);
		expect((await result.next()).value).toBe(undefined);
		expect(console.warn).toHaveBeenCalled();
	});

	it("artist", async () => {
		const result = provider.get("", "artist");
		expect((await result.next()).value).toBe(42);
	});

	it("album", async () => {
		const result = provider.get("", "album");
		expect((await result.next()).value).toBe(1337);
	});
});
