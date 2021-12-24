/**
 * Adapts worker loader to NodeJS environment
 * @param {string} source Worker source code
 */
module.exports = (source) => {
  source = source
    .replace(
      "new Worker(",
      'require("comlink/dist/umd/node-adapter.js")' +
        '(new (require("worker_threads").Worker)("./"+'
    )
    .replace(");", "));");

  return source;
};
