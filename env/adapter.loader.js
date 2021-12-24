/**
 * Comlink's adapter fix for NodeJS
 * @param {string} source Service source code
 */
module.exports = function (source) {
  return `import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";
    import { MessageChannel, parentPort } from "worker_threads";
    globalThis.self = nodeEndpoint(parentPort);
    globalThis.self.ports = [parentPort];
    let c = require("comlink");
    c.transferHandlers.set("proxy", {
      canHandle: obj => {
        return obj && obj[c.proxyMarker];
      },
      serialize: obj => {
        const { port1, port2 } = new MessageChannel();
        globalThis.self.ports.push(port1);
        c.expose(obj, nodeEndpoint(port1));
        return [port2, [port2]];
      },
      deserialize: port => {
        port = nodeEndpoint(port);
        port.start();
        return c.wrap(port);
      }
    });
    const $$expose = (...args) => {c.expose(...args);};
    ${source
      .replace("import { expose } from 'comlink';", "")
      .replace(
        /(?<!@|\.)expose(?=\(\s*Object\.)(?!.*(?<!@|\.)expose)/s,
        "$$$$expose"
      )}`;
};
