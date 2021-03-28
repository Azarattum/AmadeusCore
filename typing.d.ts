/* eslint-disable @typescript-eslint/no-unused-vars */
import { RequestInfo, RequestInit, Response } from "node-fetch";
/** Custom typings */

declare global {
	function fetch(url: RequestInfo, init?: RequestInit): Promise<Response>;
}
