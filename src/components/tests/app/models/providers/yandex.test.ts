import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import { TypeGuardError } from "typescript-is";
import YandexProvider from "../../../../app/models/providers/yandex.provider";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

const provider = new YandexProvider("token");

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

describe("Yandex", () => {
	it("get", async () => {
		expect((await provider.get("hello").next()).value).toEqual(expected);

		expect(fetchMock).toHaveFetched(/search/, {
			query: {
				page: "0",
				text: "hello"
			},
			headers: {
				Authorization: "OAuth token"
			}
		});
		expect(fetchMock).toHaveFetched(/7\/download/);
		expect(fetchMock).toHaveFetched(/url/);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		const data = provider.get("hello", 21);
		await data.next();
		await data.next();
		expect(fetchMock).toHaveFetched(/search/, { query: { page: 0 } });
		expect(fetchMock).toHaveFetched(/search/, { query: { page: 1 } });
		expect(fetchMock).toHaveFetchedTimes(6);

		fetchMock.mockClear();
	});

	it("desource", async () => {
		const desource = async (src: string) =>
			(await provider.desource(src).next()).value;

		expect(await desource("aggr://yandex:7")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("music.yandex.ru/album/0/track/1")).toEqual(
			expected
		);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("music.yandex.ru/album/0/")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("music.yandex.ru/artist/0")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("music.yandex.ru/users/a/playlists/0")).toEqual(
			expected
		);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();
	});

	it("error", async () => {
		fetchMock.get(/search/, {
			error: "some error"
		});

		await expect(provider.get("something").next()).rejects.toThrowError(
			TypeGuardError
		);

		fetchMock.mockClear();
	});
});
