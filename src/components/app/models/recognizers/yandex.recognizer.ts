import { gretch } from "gretchen";
import { Readable } from "stream";
import { is } from "typescript-is";
import { promisify } from "util";
import { v4 } from "uuid";
import { sleep } from "../../../common/utils.class";
import Recognizer from "./recognizer.abstract";

export default class YandexRecognizer extends Recognizer {
  protected baseURL = "wss://uniproxy.alice.yandex.net/uni.ws";

  private get auth() {
    return {
      event: {
        header: {
          messageId: v4(),
          name: "SynchronizeState",
          namespace: "System",
        },
        payload: {
          accept_invalid_auth: true,
          auth_token: "5983ba91-339e-443c-8452-390fe7d9d308",
          uuid: v4().replace("-", ""),
        },
      },
    };
  }

  private get header() {
    return {
      event: {
        header: {
          messageId: v4(),
          name: "Recognize",
          namespace: "ASR",
          streamId: 1,
        },
        payload: {
          lang: "",
          advancedASROptions: {
            manual_punctuation: false,
            partial_results: false,
          },
          disableAntimatNormalizer: false,
          format: "audio/opus",
          music_request2: {
            headers: {
              "Content-Type": "audio/opus",
            },
          },
          punctuation: false,
          tags: "PASS_AUDIO;",
          topic: "queries",
        },
      },
    };
  }

  private transform(data: Buffer): Buffer {
    const index = data.indexOf("OpusTags");
    if (index != -1) {
      let end = data.indexOf("OggS", index + 1);
      if (end === -1) end = data.length;
      const size = end - index;

      data = Buffer.concat([
        data.slice(0, index + 12),
        Buffer.from("#\x00\x00\x00\x00ENCODER=SpeechKit Mobile SDK v3.28.0"),
        Buffer.from("\x00".repeat(size - 53)),
        data.slice(end),
      ]);
    }

    const formatted = [];
    let search = -1;
    let position = 0;
    while ((search = data.indexOf("OggS", position)) > -1) {
      formatted.push(data.slice(position, search));
      formatted.push(Buffer.from("\x00\x00\x00\x01OggS"));
      position = search + 4;
    }

    return Buffer.concat(formatted);
  }

  private async request(
    input: string | Buffer[],
    lang: string
  ): Promise<RequestReuslt> {
    let stream;
    if (typeof input === "string") {
      const { response, status } = await gretch(input).flush();
      if (status !== 200) return null;
      stream = response.body;
    } else {
      stream = Readable.from(input);
    }

    await this.connect();
    this.send(this.auth);
    const header = this.header;
    header.event.payload.lang = lang;
    this.send(header);

    const cache = Array.isArray(input) ? input : [];
    stream.on("data", async (data: Buffer) => {
      if (typeof input === "string") {
        data = this.transform(data);
        cache.push(data);
      }
      this.send(data);
    });

    await promisify(stream.on.bind(stream))("end");

    let result;
    do {
      result = await Promise.race([this.wait(), sleep(10000)]);
      if (!result) return cache;
      if (is<IError>(result)) {
        const error = result.directive.payload.error;
        if (error.message.includes("inactivity")) {
          return cache;
        }
        throw error;
      }
    } while (!is<IMusicResult>(result));

    const track = result.directive.payload.data.match;
    return `${track.artists.map((x) => x.name).join(", ")} - ${track.title}`;
  }

  public async detect(url: string): Promise<string | null> {
    const langs = ["", "en-US", "ru-RU"];

    let input: string | Buffer[] = url;
    for (const lang of langs) {
      const result: RequestReuslt = await this.request(input, lang);
      if (!result) return null;
      if (typeof result === "string") return result;
      if (Array.isArray(result)) input = result;
    }

    return null;
  }
}

type RequestReuslt = string | Buffer[] | null;

interface IError {
  directive: {
    payload: {
      error: { message: string };
    };
  };
}

interface IMusicResult {
  directive: {
    header: {
      name: "MusicResult";
    };
    payload: {
      result: "success";
      data: {
        match: {
          title: string;
          artists: { name: string }[];
        };
      };
    };
  };
}
