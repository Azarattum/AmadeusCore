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
  id: 7,
};

const expected = {
  title: "1 (Test)",
  artists: ["2", "0"],
  album: "3",
  length: 4,
  year: 2021,
  url: "5",
  cover: undefined,
  sources: ["aggr://vk:6_7"],
};

fetchMock.get(/getById/, {
  response: [track],
});
fetchMock.get(/user/, {
  response: [{ id: 42 }],
});
fetchMock.get("*", {
  response: { items: [track] },
});

async function check(generator: AsyncGenerator<any>) {
  const value = (await generator.next()).value;
  expect(value).toEqual({
    title: expected.title,
    artists: expected.artists,
    album: expected.album,
    cover: expected.cover,
    load: value.load,
    sources: expected.sources,
    length: expected.length,
  });
  expect(typeof value.load).toBe("function");
  expect(await value.load()).toEqual(expected);
}

describe("VK", () => {
  it("get", async () => {
    await check(provider.get("hello"));

    expect(fetchMock).toHaveLastFetched(undefined, {
      query: {
        access_token: "TOKEN",
        q: "hello",
      },
    });

    fetchMock.mockClear();
  });

  it("desource", async () => {
    await check(provider.get("aggr://vk:6_77777", "source"));
    await check(provider.get("http://vk.com/audio-6_7", "source"));
    await check(provider.get("https://vk.com/audio7_4", "source"));
    await check(provider.get("vk.com/audio-1_1", "source"));
    expect(
      (await provider.get("lol.com/audio-1_1", "source").next()).value
    ).toBe(undefined);
    expect(fetchMock).toHaveFetchedTimes(4);
    fetchMock.mockClear();

    await check(provider.get("vk.com/artist/smb_1", "source"));
    await check(provider.get("vk.com/audio_playlist1_2_f", "source"));
    await check(provider.get("vk.com/username", "source"));
    expect(fetchMock).toHaveFetchedTimes(4);
    fetchMock.mockClear();
  });

  it("error", async () => {
    console.warn = jest.fn();
    fetchMock.getOnce("*", {
      error: "some error",
    });

    expect((await provider.get("something").next()).value).toBe(undefined);
    expect(console.warn).toHaveBeenCalled();

    fetchMock.mockClear();
  });
});
