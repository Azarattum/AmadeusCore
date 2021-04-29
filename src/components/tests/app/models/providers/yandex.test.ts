import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import YandexProvider from "../../../../app/models/providers/yandex.provider";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

const provider = new YandexProvider();

const track = {
	id: 7,
	title: "1",
	coverUri: "a%%",
	artists: [{ name: "2" }, { name: "0" }],
	albums: [{ title: "3", year: 2021 }],
	durationMs: 4000
};

const expected = {
	title: "1",
	artists: ["2", "0"],
	album: "3",
	length: 4,
	year: 2021,
	url: "https://b/get-mp3/7144cd15da96ba42c3367cce5dfc8015/da",
	cover: "https://a800x800",
	sources: ["aggr://yandex:7"]
};

fetchMock.get(/artists/, {
	result: { tracks: [track] }
});
fetchMock.get(/albums/, {
	result: { volumes: [[track]] }
});
fetchMock.get(/users/, {
	result: { tracks: [{ track }] }
});
fetchMock.get(/tracks\/[0-9]+$/, {
	result: [track]
});
fetchMock.get(/search/, {
	result: { tracks: { results: [track] } }
});
fetchMock.get(/download/, {
	result: [{ downloadInfoUrl: "https://url" }]
});
fetchMock.get(/url/, {
	path: "a",
	host: "b",
	s: "c",
	ts: "d"
});

async function check(generator: AsyncGenerator<any>) {
	const value = (await generator.next()).value;
	expect(value).toEqual({
		title: expected.title,
		artists: expected.artists,
		album: expected.album,
		cover: expected.cover,
		track: value.track,
		source: expected.sources[0]
	});
	expect(typeof value.track).toBe("function");
	expect(await value.track()).toEqual(expected);
}

describe("Yandex", () => {
	it("get", async () => {
		await check(provider.get("hello"));

		expect(fetchMock).toHaveFetched(/search/, {
			query: {
				page: "0",
				text: "hello"
			},
			headers: {
				Authorization: "OAuth TOKEN"
			}
		});
		expect(fetchMock).toHaveFetched(/7\/download/);
		expect(fetchMock).toHaveFetched(/url/);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		const data = provider.get("hello");
		const a = (await data.next()).value;
		const b = (await data.next()).value;
		expect(fetchMock).toHaveFetched(/search/, { query: { page: 0 } });
		expect(fetchMock).toHaveFetched(/search/, { query: { page: 1 } });
		expect(fetchMock).toHaveFetchedTimes(2);
		await a?.track();
		await b?.track();
		expect(fetchMock).toHaveFetchedTimes(6);

		fetchMock.mockClear();
	});

	it("desource", async () => {
		await check(provider.desource("aggr://yandex:7"));
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		await check(provider.desource("music.yandex.ru/album/0/track/1"));
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		await check(provider.desource("music.yandex.ru/album/0/"));
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		await check(provider.desource("music.yandex.ru/artist/0"));
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		await check(provider.desource("music.yandex.ru/users/a/playlists/0"));
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();
	});

	it("error", async () => {
		console.warn = jest.fn();
		fetchMock.get(/search/, {
			error: "some error"
		});

		expect((await provider.get("something").next()).value).toBe(undefined);
		expect(console.warn).toHaveBeenCalled();

		fetchMock.mockClear();
	});
});
