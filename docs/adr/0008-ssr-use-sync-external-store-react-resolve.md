# Resolve `use-sync-external-store/shim` to app React for Nitro SSR

Nitro’s self-contained `.output` (TanStack Start + Bun preset) can leave a runtime `__require("react")` (`createRequire`) inside inlined CJS from `use-sync-external-store/shim` — pulled in by `@base-ui/utils`. React itself is already bundled elsewhere in the server build, so that require either fails (`Cannot find module 'react'`) when `node_modules` is absent, or resolves a **second** React (e.g. Bun auto-install into the cache) and SSR hits invalid hook calls / a null dispatcher.

We work around it in `apps/web` with a Vite plugin (`vite/resolve-use-sync-external-store-from-react.ts`) that resolves the shim entry points to ESM that import from `react`, so hooks share the bundled instance. Also set `NODE_ENV=production` on the web Docker runner so the wrong React build flavor is not selected if a leak returns.

This is the same failure mode as [nitro#4171](https://github.com/nitrojs/nitro/issues/4171). Prefer Nitro’s upstream fix ([#4365](https://github.com/nitrojs/nitro/pull/4365) — `experimental.cjsRequireRewrite`) once it ships in our Nitro version; then delete the plugin and supersede this ADR.

Rejected: copying `react` into `.output/server/node_modules` after build (keeps a second resolution path); shipping full `node_modules` in the runner image; relying only on `resolve.dedupe` (does not rewrite the leaked `createRequire`).
