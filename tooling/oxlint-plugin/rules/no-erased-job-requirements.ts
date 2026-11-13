import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { isIdentifier, unwrapExpression } from "../utils.ts";

const MESSAGE =
  "Do not cast at the `runJobWorker` call: let it infer the union of the handlers' requirements, so a missing Layer is a type error.";

const isRunJobWorkerCall = (node: unknown): node is ESTree.CallExpression => {
  const expression = unwrapExpression(node);
  return (
    Option.isSome(expression) &&
    expression.value.type === "CallExpression" &&
    isIdentifier(unwrapExpression(expression.value.callee), "runJobWorker")
  );
};

/**
 * Reports a type assertion on `runJobWorker(...)` or on one of its arguments. A cast there hides a
 * Layer the worker runtime fails to provide; if mixed handlers don't type-check, fix the jobs package.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type assertions that erase requirements at the job worker's call site.",
    },
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (isRunJobWorkerCall(node.expression)) {
          context.report({ node, message: MESSAGE });
          return;
        }
        if (isRunJobWorkerCall(node.parent) && node.parent.arguments.includes(node)) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
