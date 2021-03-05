import App from "../../app/app";

describe("App", () => {
	/**
	 * Test the app on startup exceptions
	 */
	it("run", () => {
		console.log = jest.fn();
		console.error = jest.fn();
		const init = (): void => {
			const app = new App();
			app.initialize();
		};

		expect(init).not.toThrowError();
		expect(console.error).not.toBeCalled();
	});
});
