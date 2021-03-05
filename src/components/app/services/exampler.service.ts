import Service from "../../common/service.abstract";

/**
 * Example of a service.
 * Best practice to name services as `something(er/or)`
 */
export default class Exampler extends Service<"">() {
	/**
	 * Initialization of Exampler service
	 */
	public async initialize(): Promise<void> {
		///Service initialization logic goes here
	}
}
