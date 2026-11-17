import { defineRule } from "@oxlint/plugins";

const MESSAGE =
  "Use `Database`, `DatabaseTransaction` or `DatabaseExecutor` from `@repo/persistence/db/effect` instead of `Effect.Success<typeof DB>`.";

/**
 * Reports `Effect.Success<typeof DB>`, and so any method picked off it (docs/agents/nitpicks.md,
 * "Use the shared DB aliases").
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require the shared DB type aliases over `Effect.Success<typeof DB>`.",
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        const { typeName } = node;
        if (
          typeName.type !== "TSQualifiedName" ||
          typeName.left.type !== "Identifier" ||
          typeName.left.name !== "Effect" ||
          typeName.right.name !== "Success"
        ) {
          return;
        }
        const [argument] = node.typeArguments?.params ?? [];
        if (
          argument?.type === "TSTypeQuery" &&
          argument.exprName.type === "Identifier" &&
          argument.exprName.name === "DB"
        ) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
