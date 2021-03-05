import Utils, { LogType } from "../../common/utils.class";

describe("Utils", () => {
	/**
	 * Test utils log function
	 */
	it("log", () => {
		const testLog = "This is test!";
		const mock = (text: string): void => {
			expect(text).toContain(testLog);
			if (text.startsWith("=")) {
				expect(text).toHaveLength(60);
			}
		};

		console.log = jest.fn(mock);
		console.warn = jest.fn(mock);
		console.error = jest.fn(mock);

		Utils.log(testLog);
		Utils.log(testLog, LogType.INFO);
		Utils.log(testLog, LogType.OK);
		Utils.log(testLog, LogType.WARNING);
		Utils.log(testLog, LogType.ERROR);
		Utils.log(testLog, LogType.DIVIDER);
		Utils.log(testLog + "!", LogType.DIVIDER);
		expect(() => {
			Utils.log(testLog, -1);
		}).toThrow();

		expect(console.log).toBeCalledTimes(5);
		expect(console.warn).toBeCalledTimes(1);
		expect(console.error).toBeCalledTimes(1);
	});

	/**
	 * Test utils format function
	 */
	it("format", () => {
		let string = "The simplest {0}";
		string = Utils.format(string, "string");
		expect(string).toBe("The simplest string");

		string = "This {1} custom {0}";
		string = Utils.format(string, "order", "is");
		expect(string).toBe("This is custom order");

		string = "Double holder: {0}_{0}";
		string = Utils.format(string, "•");
		expect(string).toBe("Double holder: •_•");
	});

	/**
	 * Test utils unique id generation algorithm
	 */
	it("generateID", () => {
		const id = Utils.generateID();
		expect(id).toMatch(/^(?:[a-z0-9]+(?:-|$)){4}$/);
		expect(id).not.toBe(Utils.generateID());
	});

	/**
	 * Test utils conversion function
	 */
	it("convertTo", () => {
		expect(Utils.convertTo("", 1)).toBe("1");
		expect(Utils.convertTo("", { a: 1 })).toBe(JSON.stringify({ a: 1 }));

		expect(Utils.convertTo(1, { a: 1 })).toBe(NaN);
		expect(Utils.convertTo(1, "10px")).toBe(10);
		expect(Utils.convertTo(1, "-10.5")).toBe(-10.5);

		expect(Utils.convertTo(true, "-10.5")).toBeTruthy();
		expect(Utils.convertTo(true, {})).toBeTruthy();
		expect(Utils.convertTo(true, "")).toBeFalsy();
		expect(Utils.convertTo(true, 0)).toBeFalsy();

		expect(Utils.convertTo(BigInt(1), 42)).toBe(BigInt(42));
		expect(Utils.convertTo(BigInt(1), "42")).toBe(BigInt(42));
		expect(Utils.convertTo(BigInt(1), BigInt(99999))).toBe(BigInt(99999));

		const func = jest.fn();
		expect(Utils.convertTo(jest.fn(), func)).toBe(func);
		expect(Utils.convertTo(jest.fn(), 4)()).toBe(4);
		expect(Utils.convertTo(jest.fn(), "test")()).toBe("test");

		const obj = { a: 1 };
		const obj2 = { b: 2 };
		const obj3 = { a: "42" };
		expect(Utils.convertTo(obj, undefined)).toBe(obj);
		expect(Utils.convertTo(obj, null)).toBe(obj);
		expect(Utils.convertTo(obj, "test")).toBe(obj);
		expect(Utils.convertTo(obj, obj2)).toEqual({ a: 1, b: 2 });
		expect(Utils.convertTo(obj, obj3)).toEqual({ a: 42 });
		expect(Utils.convertTo(new Date(), obj)).toBeInstanceOf(Date);
		expect(Utils.convertTo(new Date(), obj).a).toBe(1);
		expect(Utils.convertTo(obj, JSON.stringify(obj2))).toEqual({
			a: 1,
			b: 2
		});

		expect(Utils.convertTo([], null)).toEqual([null]);
		expect(Utils.convertTo([], undefined)).toEqual([undefined]);
		expect(Utils.convertTo([], [1, 2, 3])).toEqual([1, 2, 3]);
		expect(Utils.convertTo([1], [1, 2, "3"])).toEqual([1, 2, 3]);
		expect(Utils.convertTo([1, "2"], [1, 2, "3"])).toEqual([1, "2", "3"]);
		expect(Utils.convertTo([1, "2"], [1, 2, 3])).toEqual([1, "2", 3]);
		expect(Utils.convertTo([], "[1, 2]")).toEqual([1, 2]);
		expect(Utils.convertTo([], '[1, "2"]')).toEqual([1, "2"]);
		expect(Utils.convertTo([], true)).toEqual([true]);
		expect(Utils.convertTo(["1"], '[1, "2"]')).toEqual(["1", "2"]);
		expect(Utils.convertTo([1], '[1, "2"]')).toEqual([1, 2]);
		expect(Utils.convertTo([1], obj)).toEqual([1]);
		expect(Utils.convertTo(["1"], obj)).toEqual(["1"]);
		expect(Utils.convertTo([1], "lol")).toEqual([NaN]);
		expect(Utils.convertTo([1, "tst"], "lol")).toEqual(["lol"]);

		expect(Utils.convertTo(null, [1, "2"])).toEqual([1, "2"]);
		expect(Utils.convertTo(undefined, [1, "2"])).toEqual([1, "2"]);
	});

	/*
	 * Test utils conversion function
	 */
	it("sleep", async () => {
		let value = 0;
		const test = async (): Promise<void> => {
			await Utils.sleep(0);
			value = 1;
		};

		expect(value).toBe(0);
		test();
		expect(value).toBe(0);
		await Utils.sleep(1);
		expect(value).toBe(1);
	});
});
