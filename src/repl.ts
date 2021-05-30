// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _ from "../typing";
import DotEnv from "dotenv";
import * as fetch from "node-fetch";
import { URL } from "url";

//Setup env
DotEnv.config();
Object.assign(globalThis, {
	...fetch,
	fetch: (...args: any[]) => {
		console.log("Requesting " + new URL(args[0].url).toString());
		const r = fetch.default(args[0], args[1]);
		r.then(x => {
			console.log("Done " + new URL(args[0].url).host, x.status);
		});
		return r;
	}
});

//Async closure
(async () => {
	//REPL
})();
