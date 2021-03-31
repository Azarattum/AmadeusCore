import fetchMock from "fetch-mock-jest";
import { TypeGuardError } from "typescript-is";
import VKProvider from "../../../../app/models/providers/vk.provider";

fetchMock.config.overwriteRoutes = true;
fetchMock.config.Request = globalThis.Request;

const provider = new VKProvider("token");

describe("Providers", () => {
	it("get", async () => {
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

		fetchMock.getOnce("*", {
			response: {
				items: [track]
			}
		});

		expect((await provider.get("hello").next()).value).toEqual({
			title: "1 (Test)",
			artists: ["2", "0"],
			album: "3",
			length: 4,
			year: 2021,
			url: "5",
			cover: undefined,
			sources: ["aggr://vk:6_7"]
		});

		expect(fetchMock).toHaveLastFetched(undefined, {
			query: {
				access_token: "token",
				q: "hello"
			}
		});
	});

	it("desource", async () => {
		fetchMock.getOnce("*", {
			response: [{ url: "42" }]
		});

		expect(await provider.desource("aggr://vk:6_7")).toEqual("42");
		expect(fetchMock).toHaveLastFetched();

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
			if (tried) return { response: [{ url: "42" }] };
			tried = true;
			return 408;
		});

		expect(await provider.desource("aggr://vk:6_7")).toEqual("42");
		expect(fetchMock).toHaveFetchedTimes(2);
		expect(tried);

		fetchMock.mockClear();
		fetchMock.reset();
	});
});
