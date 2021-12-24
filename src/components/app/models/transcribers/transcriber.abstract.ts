import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";
import { ITrackInfo } from "../track.interface";

export default abstract class Transcriber extends Fetcher {
  protected abstract assemble(source: ITrackInfo): Promise<string | null>;

  public async transcribe(source: ITrackInfo): Promise<string | null> {
    try {
      return this.assemble(source);
    } catch (e) {
      if (e.toString() === "[object Object]") {
        // eslint-disable-next-line no-ex-assign
        e = JSON.stringify(e);
      }

      wrn(
        `${this.constructor.name} failed to transcribe lyrics for "${source.title}"!\n${e}`
      );
      return null;
    }
  }
}
