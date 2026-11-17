import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";
import noEmptyJobPayload from "./rules/no-empty-job-payload.ts";
import noErasedJobRequirements from "./rules/no-erased-job-requirements.ts";
import noInlineSchemaCompile from "./rules/no-inline-schema-compile.ts";
import noManualEffectRuntimeInTests from "./rules/no-manual-effect-runtime-in-tests.ts";
import noTaggedErrorFactory from "./rules/no-tagged-error-factory.ts";
import noTestInLoop from "./rules/no-test-in-loop.ts";
import preferCatchTags from "./rules/prefer-catch-tags.ts";
import preferDbAliases from "./rules/prefer-db-aliases.ts";
import requireSuppressionReason from "./rules/require-suppression-reason.ts";
import staticErrorMessage from "./rules/static-error-message.ts";

export default definePlugin({
  meta: {
    name: "relayit",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-empty-job-payload": noEmptyJobPayload,
    "no-erased-job-requirements": noErasedJobRequirements,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-tagged-error-factory": noTaggedErrorFactory,
    "no-test-in-loop": noTestInLoop,
    "prefer-catch-tags": preferCatchTags,
    "prefer-db-aliases": preferDbAliases,
    "require-suppression-reason": requireSuppressionReason,
    "static-error-message": staticErrorMessage,
  },
});
