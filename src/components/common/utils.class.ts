/**
 * Some useful utilities
 */
export default class Utils {
	/**
	 * Logs formatted text to the developer console
	 * @param text Text to log out
	 * @param type Custom type of the message
	 */
	public static log(text: string, type: LogType = LogType.INFO): void {
		const date = new Date().toTimeString().split(" ")[0];
		const prefix = `[${date}]: `;

		switch (type) {
			case LogType.INFO: {
				console.log(
					prefix + "%c\x1b[1mi\x1b[0m " + text,
					"font-weight:bold;"
				);
				break;
			}

			case LogType.OK: {
				console.log(
					prefix + "\x1b[32m\x1b[1m%c\u2713 " + text + "\x1b[0m",
					"color:green;font-weight:bold;"
				);
				break;
			}

			case LogType.ERROR: {
				console.error(
					prefix + "\x1b[31m\x1b[1m%c\u2718 " + text + "\x1b[0m",
					"color:red;font-weight:bold;"
				);
				break;
			}

			case LogType.WARNING: {
				console.warn(
					prefix +
						"\x1b[33m\x1b[1m%c!\x1b[0m \x1b[33m" +
						text +
						"\x1b[0m",
					"color:goldenrod;font-weight:bold;"
				);
				break;
			}

			case LogType.DIVIDER: {
				const divider = "=".repeat(30 - text.length / 2);
				console.log(
					divider + text + divider + (text.length % 2 ? "=" : "")
				);
				break;
			}

			default:
				throw new TypeError("Unknown log type!");
		}
	}

	/**
	 * Formates string using placeholders.
	 * Example: `hello {0}!` to `hello world!`, where `world` is your argument
	 * @param string Format string
	 * @param args Values to be inserted
	 */
	public static format(string: string, ...args: string[]): string {
		for (const i in args) {
			const pattern = new RegExp(`[{]${i}[}]`, "g");
			string = string.replace(pattern, args[i]);
		}

		return string;
	}

	/**
	 * Randomly generates universal unique id
	 */
	public static generateID(): string {
		return new Array(4)
			.fill(0)
			.map(() =>
				Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)
			)
			.join("-");
	}

	/**
	 * Returns data converted to a given prototype. With respect to object prototypes,
	 * array types and primitive types. Supports JSON conversions.
	 * If `proto` is undefined the data returns unchanged.
	 * @param proto A prototype value for conversion
	 * @param data Data value to convert
	 */
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public static convertTo(proto: any, data: any): any {
		if (typeof proto === "string") {
			return typeof data === "object"
				? JSON.stringify(data)
				: String(data);
		} else if (typeof proto === "number") {
			return Number.parseFloat(data);
		} else if (typeof proto === "boolean") {
			return !!data;
		} else if (typeof proto === "bigint") {
			return typeof data === "bigint"
				? data
				: BigInt(Number.parseInt(data));
		} else if (typeof proto === "function") {
			return typeof data === "function" ? data : (): any => data;
		} else if (typeof proto === "object" && proto !== null) {
			if (typeof data === "string") {
				try {
					data = JSON.parse(data);
				} catch {
					//Do nothing
				}
			}
			if (Array.isArray(proto)) {
				const unitype: boolean = proto.every(
					(x: any) => typeof x === typeof proto[0]
				);

				if (typeof data === "object" && data !== null) {
					if (!Array.isArray(data)) data = Object.values(data);
					const converted: any[] = [];

					for (let i = 0; i < data.length; i++) {
						let type = proto[i];
						if (typeof type === "undefined" && unitype)
							type = proto[0];

						converted[i] = Utils.convertTo(type, data[i]);
					}

					return converted;
				} else {
					return [unitype ? Utils.convertTo(proto[0], data) : data];
				}
			} else {
				if (typeof data === "object" && data !== null) {
					const converted: Record<any, any> = Object.create(
						Object.getPrototypeOf(proto)
					);
					Object.assign(converted, proto);

					for (const key in data) {
						converted[key] = Utils.convertTo(proto[key], data[key]);
					}
					return converted;
				} else {
					return proto;
				}
			}
		}

		return data;
	}

	/**
	 * Promise based delay function. Wrapper over setTimeout
	 * @param ms Time in milliseconds
	 */
	public static async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Returns a copy of the array but shuffled
	 * @param array Array to shuffle
	 */
	public static shuffle<T>(array: T[]): T[] {
		array = [...array];
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}

		return array;
	}

	/**
	 * Returns first n items from the given async generator
	 * @param generator Generator function of items
	 * @param n Number of items
	 */
	public static async nFirst<T>(
		generator: AsyncGenerator<T>,
		n: number
	): Promise<T[]> {
		const promises = [];
		for (let i = 0; i < n; i++) {
			promises.push(generator.next());
		}

		const resolved = await Promise.all(promises);
		return resolved.filter(x => !x.done).map(x => x.value);
	}

	/**
	 * Merges an array of async generators into a single one
	 * @param generators Generators to merge
	 */
	public static async *mergeGenerators<T>(
		generators: AsyncGenerator<T>[]
	): AsyncGenerator<T> {
		let available;
		do {
			available = 0;
			for (const generator of generators) {
				const item = await generator.next();
				if (item.done) continue;
				yield item.value;
				available++;
			}
		} while (available);
	}

	/**
	 * Creates an async generator from any item or an array of items
	 * @param from Source item or array
	 */
	public static generate<T>(from: T | T[]): AsyncGenerator<T> {
		return (async function*() {
			if (Array.isArray(from)) {
				for (const item of from) {
					yield item;
				}
			} else {
				yield from;
			}
		})();
	}
}

/**
 * Logging message type
 */
export enum LogType {
	INFO,
	OK,
	WARNING,
	ERROR,
	DIVIDER
}

//Shortcuts for exports
const log = Utils.log;
const wrn = (text: string): void => Utils.log(text, LogType.WARNING);
const err = (text: string): void => Utils.log(text, LogType.ERROR);
const format = Utils.format;
const generateID = Utils.generateID;
const convertTo = Utils.convertTo;
const sleep = Utils.sleep;
const shuffle = Utils.shuffle;
const nFirst = Utils.nFirst;
const mergeGenerators = Utils.mergeGenerators;
const generate = Utils.generate;
export {
	log,
	wrn,
	err,
	format,
	generateID,
	convertTo,
	sleep,
	shuffle,
	nFirst,
	mergeGenerators,
	generate
};
