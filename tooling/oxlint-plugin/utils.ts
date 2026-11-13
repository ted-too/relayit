import type { ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion;

type AstNode = ESTree.Node;

const asAstNode = (node: unknown): Option.Option<AstNode> =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
    ? Option.some(node as AstNode)
    : Option.none();

const isExpressionWrapper = (node: AstNode): node is ExpressionWrapper =>
  node.type === "ChainExpression" ||
  node.type === "ParenthesizedExpression" ||
  node.type === "TSNonNullExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSTypeAssertion";

export function unwrapExpression(node: unknown): Option.Option<AstNode> {
  let current = asAstNode(node);

  while (Option.isSome(current) && isExpressionWrapper(current.value)) {
    current = asAstNode(current.value.expression);
  }

  return current;
}

export function getPropertyName(node: unknown): Option.Option<string> {
  return Option.flatMap(asAstNode(node), (expression) => {
    if (expression.type === "Identifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "PrivateIdentifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return Option.some(expression.value);
    }
    return Option.none();
  });
}

export function isIdentifier(node: Option.Option<AstNode>, name?: string): boolean {
  if (Option.isNone(node)) return false;
  const expression = node.value;
  return (
    expression.type === "Identifier" &&
    typeof expression.name === "string" &&
    (name === undefined || expression.name === name)
  );
}

// The built-in errors, which are not tagged and take a positional message.
const BUILT_IN_ERRORS = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

/**
 * The class name of `new SomeError(...)` when it names a repo error class: an identifier ending in
 * `Error` that is not a built-in. Every tagged error in the repo follows that naming.
 */
export function taggedErrorName(node: unknown): Option.Option<string> {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression) || expression.value.type !== "NewExpression") {
    return Option.none();
  }
  const callee = unwrapExpression(expression.value.callee);
  if (Option.isNone(callee) || callee.value.type !== "Identifier") return Option.none();
  const { name } = callee.value;
  return name.endsWith("Error") && !BUILT_IN_ERRORS.has(name) ? Option.some(name) : Option.none();
}
