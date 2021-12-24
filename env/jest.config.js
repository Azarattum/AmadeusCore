module.exports = {
  rootDir: "..",
  transform: { "^.+\\.ts?$": "ts-jest" },
  globals: {
    "ts-jest": {
      compiler: "ttypescript",
    },
  },
};
