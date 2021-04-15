import * as fetch from "node-fetch";
import fetchMock from "fetch-mock-jest";
import SoundCloudProvider from "../../../../app/models/providers/soundcloud.provider";

Object.assign(globalThis, { ...fetch, fetch });
fetchMock.config.overwriteRoutes = true;

const provider = new SoundCloudProvider();

const track = {
	created_at: "2021-03-31",
	full_duration: 3000,
	id: 4,
	release_date: "2021-03-31",
	title: "5",
	media: {
		transcodings: [{ url: "url", format: { protocol: "progressive" } }]
	},
	user: {
		id: 42,
		username: "6",
		avatar_url: "large.jpg"
	}
};

const expected = {
	title: "5",
	artists: ["6"],
	album: "5",
	length: 3,
	year: 2021,
	url: "7",
	cover: "original.jpg",
	sources: ["aggr://soundcloud:4"]
};

fetchMock.get(/search/, {
	collection: [track]
});
fetchMock.get(/users\/1337\/tracks/, {
	collection: [{}, {}],
	next_href: "users/42/tracks"
});
fetchMock.get(/users\/42\/tracks/, { collection: [{}, track] });
fetchMock.get(/tracks/, track);
fetchMock.get(/notoriginal.jpg/, 408);
fetchMock.get(/original.jpg/, 200);
fetchMock.get(/aUser/, { id: 1337, username: "name" });
fetchMock.get(/aPlaylist/, { tracks: [{}, track] });
fetchMock.get(/url/, { url: "7" });

describe("SoundCloud", () => {
	it("get", async () => {
		expect((await provider.get("hello").next()).value).toEqual(expected);

		expect(fetchMock).toHaveFetched(undefined, {
			query: {
				client_id: "TOKEN",
				q: "hello"
			}
		});

		fetchMock.mockClear();
	});

	it("desource", async () => {
		const desource = async (src: string) =>
			(await provider.desource(src).next()).value;

		expect(await desource("aggr://soundcloud:0")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("soundcloud.com/tracks")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("soundcloud.com/aPlaylist")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(3);
		fetchMock.mockClear();

		expect(await desource("soundcloud.com/aUser")).toEqual(expected);
		expect(fetchMock).toHaveFetchedTimes(5);
		fetchMock.mockClear();
	});

	it("error", async () => {
		console.warn = jest.fn();
		fetchMock.getOnce(/search/, {
			error: "some error"
		});

		expect((await provider.get("something").next()).value).toBe(undefined);
		expect(console.warn).toHaveBeenCalled();

		fetchMock.mockClear();
	});

	it("cover", async () => {
		fetchMock.get(/tracks/, { ...track, artwork_url: "notlarge.jpg" });

		expect(
			(await provider.desource("aggr://soundcloud:0").next()).value
		).toEqual({ ...expected, cover: "nott500x500.jpg" });
		expect(fetchMock).toHaveFetchedTimes(3, /notoriginal.jpg/);
		expect(fetchMock).toHaveFetchedTimes(5);

		fetchMock.mockClear();
	});
});
