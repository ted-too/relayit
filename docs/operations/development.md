# Development

Needs bun (the version in `package.json`'s `packageManager`), portless installed globally (it needs Node 24), a local Postgres 18 and Redis 7 (the versions `docker-compose.yaml` runs), and the GitHub CLI with the stack extension (`gh extension install github/gh-stack`). `vp` comes with the dependencies; Vite+'s global install puts it on your PATH.

```sh
bun install          # also patches tsc and installs the commit hook
bun run dev          # api, web, builder and site through portless; read the next section first
```

## Environment

Each app reads the `.env` in its own directory (bun loads it from the working directory), and so does `packages/persistence` for `db:generate`. The variables each app requires are in its schema: `apps/api/src/env.ts`, `apps/web/src/env.ts`, `apps/template-builder/src/env.ts`. `apps/site` reads only `APP_URL`. The root `env.example` is for Docker Compose, not for development.

What each app reaches when it starts:

- **Every app** applies pending migrations to its `DATABASE_URL`.
- **api** ensures SES and SNS infrastructure for every email Provider in that database, with that Provider's stored AWS credentials, and Cloudflare DNS when `CF_API_TOKEN`, `CF_ROOT_DOMAIN` and `CF_ZONE_ID` are set; then starts the job worker, which sends any queued email.
- **web** talks to Stripe when `STRIPE_*` is set and to Cloudflare when `CF_*` is; adding a Domain or a Provider in the dashboard creates real SES identities and infrastructure.

What a dev server touches depends on the database and keys you give it. A fresh local database holds no Providers, and with `CF_*` and `STRIPE_*` unset nothing reaches Cloudflare or Stripe. The `.env` files in Ted's checkout hold real credentials: don't start the api or `bun run dev` with them unless Ted asks for that run.

`TEMPLATING_BUILDER_URL` and `TEMPLATING_BUILDER_SECRET` connect web to the builder; without them the Template catalog works but Email Workspaces don't. `BETTER_AUTH_SECRETS` must be the same in every app that reads it, since it signs sessions and seals Provider credentials and DKIM keys.

## Tests

`bun run test` runs every package's tests and stops at the first package that fails. Most packages use `bun test`; `packages/template-render` and `tooling/oxlint-plugin` use Vitest.

Integration tests that need Postgres or Redis run only when `TEST_DATABASE_URL` or `TEST_REDIS_URL` is set, and skip otherwise; CI sets neither. `packages/jobs/.env.example` and `packages/channels/.env.example` show the values for a local database and Redis. Point `TEST_DATABASE_URL` at a database you can throw away.

## Schema changes

Change `packages/persistence/src/db/schema/` (or the jobs package's `*-schema.ts`), run `vp run --filter @repo/persistence db:generate`, and read the generated SQL. It needs a `DATABASE_URL` in `packages/persistence/.env` to load its config, but doesn't connect. The next app start applies it. If generate asks whether a column was renamed, or fails for want of a TTY, ask Ted to run it. Never edit a generated migration; if one is wrong before it merges, delete its folder and generate again.
