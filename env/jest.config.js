const fetch = require("node-fetch");

module.exports = {
	rootDir: "..",
	transform: { "^.+\\.ts?$": "ts-jest" },
	globals: {
		"ts-jest": {
			compiler: "ttypescript"
		},
		fetch: fetch.default,
		...fetch
	}
};
