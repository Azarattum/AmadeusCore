/**
 * TheFramework's custom set of ESLint rules
 */
module.exports.rules = {
  "require-async-service": (context) => ({
    MethodDefinition: (node) => {
      const isService =
        node.parent &&
        node.parent.parent &&
        node.parent.parent.superClass &&
        node.parent.parent.superClass.callee &&
        node.parent.parent.superClass.callee.name &&
        node.parent.parent.superClass.callee.name === "Service";

      if (!!isService && node.accessibility === "public" && !node.value.async) {
        context.report(
          node,
          "Public interface of service has to be asynchronous!"
        );
      }
    },
  }),
};
