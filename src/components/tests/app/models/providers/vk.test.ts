import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import { TypeGuardError } from "typescript-is";
import VKProvider from "../../../../app/models/providers/vk.provider";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

const provider = new VKProvider("token");

const track = {
	title: "1 (Test) (Test)",
	artist: "2 & 0",
	album: { title: "3" },
	duration: 4,
	date: 1617188680,
	url: "5",
	owner_id: 6,
	id: 7
};

const expected = {
	title: "1 (Test)",
	artists: ["2", "0"],
	album: "3",
	length: 4,
	year: 2021,
	url: "5",
	cover: undefined,
	sources: ["aggr://vk:6_7"]
};

describe("Providers", () => {
	it("get", async () => {
		fetchMock.getOnce("*", {
			response: {
				items: [track]
			}
		});

		expect((await provider.get("hello").next()).value).toEqual(expected);

		expect(fetchMock).toHaveLastFetched(undefined, {
			query: {
				access_token: "token",
				q: "hello"
			}
		});

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("desource", async () => {
		fetchMock.get(/getById/, {
			response: [track]
		});
		fetchMock.get(/user/, {
			response: [{ id: 42 }]
		});
		fetchMock.get("*", {
			response: { items: [track] }
		});

		expect(
			(await provider.desource("aggr://vk:6_77777").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("http://vk.com/audio-6_7").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("https://vk.com/audio7_4").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("vk.com/audio-1_1").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("lol.com/audio-1_1").next()).value
		).toEqual(undefined);
		expect(fetchMock).toHaveBeenCalledTimes(4);

		expect(
			(await provider.desource("vk.com/artist/smb_1").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("vk.com/audio_playlist1_2_f").next()).value
		).toEqual(expected);
		expect(
			(await provider.desource("vk.com/username").next()).value
		).toEqual(expected);
		expect(fetchMock).toHaveBeenCalledTimes(8);

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("error", async () => {
		fetchMock.getOnce("*", {
			error: "some error"
		});

		await expect(provider.get("something").next()).rejects.toThrowError(
			TypeGuardError
		);

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("retry", async () => {
		let tried = false;
		fetchMock.get("*", () => {
			if (tried) return { response: [track] };
			tried = true;
			return 408;
		});

		expect(
			(await provider.desource("aggr://vk:6_77777").next()).value
		).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(2);
		expect(tried);

		fetchMock.mockClear();
		fetchMock.reset();
	});

	it("empty", async () => {
		let tried = false;
		fetchMock.get("*", () => {
			if (tried) return { response: [track] };
			tried = true;
			return 200;
		});

		expect((await provider.desource("aggr://vk:1_2").next()).value).toEqual(
			expected
		);
		expect(fetchMock).toHaveFetchedTimes(2);
		expect(tried);

		fetchMock.mockClear();
		fetchMock.reset();
	});
});
