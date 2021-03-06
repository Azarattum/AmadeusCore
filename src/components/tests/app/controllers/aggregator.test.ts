import Aggregator from "../../../app/controllers/aggregator.controller";
import Provider from "../../../app/models/providers/provider.abstract";
import Recommender from "../../../app/models/recommenders/recommender.abstract";
import { TrackPreview } from "../../../app/models/track.interface";

class TestProvider extends Provider {
  protected baseURL: string = "";
  protected convert(track: any): TrackPreview {
    const data = track + "";
    const converted = {
      title: data,
      album: data,
      artists: [data],
      length: 0,
      sources: [data],
      url: data,
    };

    return {
      title: converted.title,
      artists: converted.artists,
      album: converted.album,
      sources: converted.sources,
      length: 0,

      load: async () => converted,
    };
  }
  protected async *identify(source: string): AsyncGenerator<any, any, unknown> {
    yield source;
  }
  protected async *search(query: string): AsyncGenerator<any, any, unknown> {
    yield query;
  }
  protected async *artist(query: string): AsyncGenerator<any, any, unknown> {
    yield query;
  }
  protected async *album(query: string): AsyncGenerator<any, any, unknown> {
    yield query;
  }
}

class TestRecommender extends Recommender {
  protected async assemble(source: string): Promise<string[]> {
    return ["recommended"];
  }
}

const aggr = new Aggregator();
aggr.initialize({
  providers: [new TestProvider()],
  recommenders: [new TestRecommender()],
});

describe("Aggregator", () => {
  it("get", async () => {
    const tracks = aggr.get("test");
    const any = jest.fn();
    for await (const track of tracks) {
      expect(await track.load()).toEqual({
        title: "test",
        album: "test",
        artists: ["test"],
        length: 0,
        sources: ["test"],
        url: "test",
      });
      any();
    }

    expect(any).toHaveBeenCalledTimes(1);
  });

  it("desource", async () => {
    const tracks = aggr.desource(["42"]);
    const any = jest.fn();
    for await (const track of tracks) {
      expect(await track.load()).toEqual({
        title: "42",
        album: "42",
        artists: ["42"],
        length: 0,
        sources: ["42"],
        url: "42",
      });
      any();
    }

    expect(any).toHaveBeenCalledTimes(1);

    const jsoned = aggr.desource([{ sources: '["42"]' }]);
    for await (const track of jsoned) {
      expect(await track.load()).toEqual({
        title: "42",
        album: "42",
        artists: ["42"],
        length: 0,
        sources: ["42"],
        url: "42",
      });
      any();
    }

    expect(any).toHaveBeenCalledTimes(2);

    const objects = aggr.desource([{ sources: "42" }]);
    for await (const track of objects) {
      expect(await track.load()).toEqual({
        title: "42",
        album: "42",
        artists: ["42"],
        length: 0,
        sources: ["42"],
        url: "42",
      });
      any();
    }

    expect(any).toHaveBeenCalledTimes(3);
  });

  it("recommend", async () => {
    const tracks = aggr.recommend([""]);
    const any = jest.fn();
    for await (const track of tracks) {
      expect(await track.load()).toEqual({
        title: "recommended",
        album: "recommended",
        artists: ["recommended"],
        length: 0,
        sources: ["recommended"],
        url: "recommended",
      });
      any();
    }

    expect(any).toHaveBeenCalledTimes(1);
  });
});
