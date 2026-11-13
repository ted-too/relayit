import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { taggedErrorName, unwrapExpression } from "../utils.ts";

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

const isFunction = (node: ESTree.Node): node is FunctionNode =>
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionExpression" ||
  node.type === "FunctionDeclaration";

/** What a function returns when its body is a single expression or a single `return`. */
const onlyResult = (fn: FunctionNode): Option.Option<ESTree.Node> => {
  const { body } = fn;
  if (body === null || body === undefined) return Option.none();
  if (body.type !== "BlockStatement") return unwrapExpression(body);
  const [statement] = body.body;
  if (body.body.length !== 1 || statement?.type !== "ReturnStatement") return Option.none();
  return unwrapExpression(statement.argument);
};

/** The error class a function, or a curried chain of them, does nothing but construct. */
const constructedError = (fn: FunctionNode): Option.Option<string> =>
  Option.flatMap(onlyResult(fn), (result) =>
    isFunction(result) ? constructedError(result) : taggedErrorName(result),
  );

const message = (name: string) =>
  `Construct ${name} where it is raised, with its named fields, rather than through a factory function.`;

/**
 * Reports a named function whose only job is `new SomeError({ ... })`, curried or not: the
 * constructor is the API, and a factory hides its fields behind positional arguments. An inline
 * callback such as `Effect.mapError((cause) => new SomeError({ cause }))` is the call site, so it is
 * not reported.
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow factory functions that only construct a tagged error.",
    },
  },
  create(context) {
    const check = (fn: FunctionNode, reportOn: ESTree.Node) => {
      const name = constructedError(fn);
      if (Option.isSome(name)) context.report({ node: reportOn, message: message(name.value) });
    };

    return {
      FunctionDeclaration(node) {
        check(node, node.id ?? node);
      },
      VariableDeclarator(node) {
        const init = unwrapExpression(node.init);
        if (Option.isSome(init) && isFunction(init.value)) check(init.value, node.id);
      },
    };
  },
});
