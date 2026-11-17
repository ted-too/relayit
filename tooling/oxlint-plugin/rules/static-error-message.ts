import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, taggedErrorName, unwrapExpression } from "../utils.ts";

const MESSAGE =
  "Keep an error's `message` static; put the identifiers and other varying data in their own fields.";

/**
 * Reports `new SomeError({ message: \`...${value}...\` })` (docs/agents/nitpicks.md, "Keep error
 * `message` static; put identifiers in fields"). Logs and metrics key off the fields; the message is
 * stable copy.
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow interpolating values into a tagged error's message.",
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (Option.isNone(taggedErrorName(node))) return;
        const payload = unwrapExpression(node.arguments[0]);
        if (Option.isNone(payload) || payload.value.type !== "ObjectExpression") return;

        for (const property of payload.value.properties) {
          if (property.type !== "Property" || property.computed) continue;
          const key = getPropertyName(property.key);
          if (Option.isNone(key) || key.value !== "message") continue;
          const value = unwrapExpression(property.value);
          if (
            Option.isSome(value) &&
            value.value.type === "TemplateLiteral" &&
            value.value.expressions.length > 0
          ) {
            context.report({ node: property.value, message: MESSAGE });
          }
        }
      },
    };
  },
});
