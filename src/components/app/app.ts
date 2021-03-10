import Application from "../common/application.abstract";
import Endpointer from "./controllers/endpointer.controller";

/**
 * Application class
 */
export default class App extends Application {
	/**
	 * Application constructor
	 */
	public constructor() {
		super([Endpointer]);
	}

	/**
	 * Initializes the app
	 */
	public async initialize(): Promise<void> {
		///  .initialize([Component, arg1, arg2, arg3...], [Component2, ...])
		await super.initialize();
	}
}
