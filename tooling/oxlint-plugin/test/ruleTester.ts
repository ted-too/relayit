import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vite-plus/test";

// Runs each rule in this process, so a case costs milliseconds rather than an oxlint
// start. `plugin.test.ts` is what proves the real binary loads the plugin.
RuleTester.describe = describe;
RuleTester.it = it;

export const ruleTester = new RuleTester({
  languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } },
});
