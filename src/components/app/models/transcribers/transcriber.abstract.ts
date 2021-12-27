import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Transcriber extends Fetcher {
  protected abstract assemble(source: string): Promise<string | null>;

  public async transcribe(source: string): Promise<string | null> {
    try {
      return this.assemble(source);
    } catch (e) {
      if (e.toString() === "[object Object]") {
        // eslint-disable-next-line no-ex-assign
        e = JSON.stringify(e);
      }

      wrn(
        `${this.constructor.name} failed to transcribe lyrics for "${source}"!\n${e}`
      );
      return null;
    }
  }
}
