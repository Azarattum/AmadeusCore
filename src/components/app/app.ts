import Application from "../common/application.abstract";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([
			///Put your components here
		]);
	}

	/**
	 * Initializes the app
	 */
	public async initialize(): Promise<void> {
		///Put components' configurations here
		///  .initialize([Component, arg1, arg2, arg3...], [Component2, ...])
		await super.initialize();
	}
}
