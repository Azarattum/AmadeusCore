import { wrn } from "../../../common/utils.class";
import Fetcher from "../fetcher.abstract";

export default abstract class Recognizer extends Fetcher {
	protected abstract detect(url: string): Promise<string | null>;

	public async recognise(url: string): Promise<string | null> {
		try {
			return this.detect(url);
		} catch (e) {
			if (e.toString() === "[object Object]") {
				// eslint-disable-next-line no-ex-assign
				e = JSON.stringify(e);
			}

			wrn(`${this.constructor.name} failed to recognise audio!\n${e}`);
			return null;
		}
	}
}
