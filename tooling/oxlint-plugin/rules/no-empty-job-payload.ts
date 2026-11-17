import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, isIdentifier, unwrapExpression } from "../utils.ts";

const MESSAGE =
  "Omit `payload` from a job with none; producers use the no-payload overloads instead of passing `{}`.";

/** Whether `node` is `Schema.Struct({})` or `Struct({})`. */
const isEmptyStruct = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression) || expression.value.type !== "CallExpression") return false;
  const callee = unwrapExpression(expression.value.callee);
  const isStruct =
    isIdentifier(callee, "Struct") ||
    (Option.isSome(callee) &&
      callee.value.type === "MemberExpression" &&
      isIdentifier(unwrapExpression(callee.value.object), "Schema") &&
      Option.contains(getPropertyName(callee.value.property), "Struct"));
  if (!isStruct || expression.value.arguments.length !== 1) return false;
  const fields = unwrapExpression(expression.value.arguments[0]);
  return (
    Option.isSome(fields) &&
    fields.value.type === "ObjectExpression" &&
    fields.value.properties.length === 0
  );
};

/**
 * Reports `defineJob({ payload: Schema.Struct({}) })`. A job with no payload omits `payload`, so its
 * producers use the no-payload overloads instead of passing a dummy `{}` at every call site.
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow an empty struct as a job's payload schema.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isIdentifier(unwrapExpression(node.callee), "defineJob")) return;
        const contract = unwrapExpression(node.arguments[0]);
        if (Option.isNone(contract) || contract.value.type !== "ObjectExpression") return;

        for (const property of contract.value.properties) {
          if (property.type !== "Property" || property.computed) continue;
          if (!Option.contains(getPropertyName(property.key), "payload")) continue;
          if (isEmptyStruct(property.value)) context.report({ node: property, message: MESSAGE });
        }
      },
    };
  },
});
