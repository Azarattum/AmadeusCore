import { is } from "typescript-is";
import Recognizer from "./recognizer.abstract";

export default class AudDRecognizer extends Recognizer {
  protected baseURL = "https://api.audd.io/";

  public constructor(token: string = "TOKEN") {
    super(token);
    if (this.token !== "TOKEN") {
      this.params["api_token"] = this.token;
    }
  }

  public async detect(url: string): Promise<string | null> {
    const data = await this.call("", { url });

    if (!is<IRecognitionResult>(data)) return null;
    return `${data.result.artist} - ${data.result.title}`;
  }
}

interface IRecognitionResult {
  status: "success";
  result: {
    artist: string;
    title: string;
  };
}
