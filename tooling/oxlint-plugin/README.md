# @repo/oxlint-plugin

Repo-specific oxlint rules, loaded through `lint.jsPlugins` in the root `vite.config.ts` under the `relayit/` namespace. Each rule has a test next to it that runs the rule against code samples with oxlint's `RuleTester`; `plugin.test.ts` runs the real oxlint binary once, to prove it loads the plugin and every rule.

Add a rule when the same review comment has come up twice. The ones that enforce an entry in [`docs/agents/nitpicks.md`](../../docs/agents/nitpicks.md) say which in their doc comment: `no-tagged-error-factory`, `static-error-message`, `prefer-db-aliases`, `no-empty-job-payload` and `no-erased-job-requirements`. The rest of the starting set comes from Ted's other repo, most of it adapted from [T3 Code](https://github.com/pingdotgg/t3code)'s `oxlint-plugin-t3code` (MIT, © T3 Tools Inc.).

The tests run on Vitest through Vite+ (`vp test`), which is why this package is the one place they don't use `bun test`.
