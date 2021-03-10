import Controller from "../../common/controller.abstract";
import Endpoint from "../models/endpoints/endpoint.abstract";
import TelegramBotEndpoint from "../models/endpoints/tgbot.endpoint";

/**
 * Controlls all the Amadeus' endpoints
 */
export default class Enpointer extends Controller<"">() {
	private endpoints: Endpoint[];

	public constructor(args: any) {
		super(args);
		this.endpoints = [
			new TelegramBotEndpoint(process.env["BOT_TOKEN"] as string)
		];
	}

	/**
	 * Starts endpoints at initialization
	 */
	public async initialize(): Promise<void> {
		for (const endpoint of this.endpoints) {
			endpoint.start();
		}
	}

	/**
	 * Stops endpoints when closing
	 */
	public async close(): Promise<void> {
		const promises = [];
		for (const endpoint of this.endpoints) {
			promises.push(endpoint.stop());
		}

		await Promise.all(promises);
	}
}
