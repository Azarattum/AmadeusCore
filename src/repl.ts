import DotEnv from "dotenv";
import * as fetch from "node-fetch";

//Setup env
DotEnv.config();
Object.assign(globalThis, { ...fetch, fetch });

//Async closure
(async () => {
	//REPL
})();
