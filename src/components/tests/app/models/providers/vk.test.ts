import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import VKProvider from "../../../../app/models/providers/vk.provider";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

const provider = new VKProvider();

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

fetchMock.get(/getById/, {
	response: [track]
});
fetchMock.get(/user/, {
	response: [{ id: 42 }]
});
fetchMock.get("*", {
	response: { items: [track] }
});

async function check(generator: AsyncGenerator<any>) {
	const value = (await generator.next()).value;
	expect(value).toEqual({
		title: expected.title,
		artists: expected.artists,
		album: expected.album,
		cover: expected.cover,
		track: value.track
	});
	expect(typeof value.track).toBe("function");
	expect(await value.track()).toEqual(expected);
}

describe("VK", () => {
	it("get", async () => {
		await check(provider.get("hello"));

		expect(fetchMock).toHaveLastFetched(undefined, {
			query: {
				access_token: "TOKEN",
				q: "hello"
			}
		});

		fetchMock.mockClear();
	});

	it("desource", async () => {
		await check(provider.desource("aggr://vk:6_77777"));
		await check(provider.desource("http://vk.com/audio-6_7"));
		await check(provider.desource("https://vk.com/audio7_4"));
		await check(provider.desource("vk.com/audio-1_1"));
		expect(
			(await provider.desource("lol.com/audio-1_1").next()).value
		).toBe(undefined);
		expect(fetchMock).toHaveFetchedTimes(4);
		fetchMock.mockClear();

		await check(provider.desource("vk.com/artist/smb_1"));
		await check(provider.desource("vk.com/audio_playlist1_2_f"));
		await check(provider.desource("vk.com/username"));
		expect(fetchMock).toHaveFetchedTimes(4);
		fetchMock.mockClear();
	});

	it("error", async () => {
		console.warn = jest.fn();
		fetchMock.getOnce("*", {
			error: "some error"
		});

		expect((await provider.get("something").next()).value).toBe(undefined);
		expect(console.warn).toHaveBeenCalled();

		fetchMock.mockClear();
	});
});
