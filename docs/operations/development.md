# Development

Needs bun (the version in `package.json`'s `packageManager`), Docker (`bun run test` starts its own Postgres and Redis in it), a local Postgres 18 and Redis 7 (the versions `docker-compose.yaml` runs), and the GitHub CLI with the stack extension (`gh extension install github/gh-stack`). `vp` comes with the dependencies; Vite+'s global install puts it on your PATH.

```sh
bun install          # also patches tsc and installs the commit hook
cp .env.example .env # then point DATABASE_URL at an empty local database
bun run db:migrate
bun run db:seed      # a user, a Project, a Domain and an API key; it prints how to use them
bun run dev          # dashboard :3000, site :3001, api :3005, builder :3006, and the worker
```

For a fresh start, drop and recreate the database, then migrate and seed again. Tests need no `.env`.

## Environment

Development reads one file, the root `.env`, made from `.env.example`. The apps' dev scripts, `db:migrate`, `db:seed` and the Drizzle scripts read it through `tooling/scripts/src/with-env.ts`, which gives each app its port as `PORT` and builds the URLs the apps reach each other by (`API_URL`, `APP_URL`, `VITE_BASE_URL`, `TEMPLATING_BUILDER_URL`) from `WEB_PORT`, `SITE_PORT`, `API_PORT` and `BUILDER_PORT`. Set ports, not URLs. `with-env.ts` refuses to start beside a `.env` inside an app or package, because Vite and Nitro would still load it under the root one. The variables each app accepts are in its schema: `apps/api/src/env.ts`, `apps/worker/src/env.ts`, `apps/web/src/env.ts`, `apps/template-builder/src/env.ts`. The worker has no port: it serves no HTTP.

`env.example`, without the dot, is the Docker Compose file for self-hosting, and has nothing to do with this.

What the apps reach, and what `.env.example` sets so that none of it is real:

| Variable                       | `.env.example`                        | Unset                                                                                 |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `EMAIL_BACKEND`                | `fake`                                | fake under `NODE_ENV` development or test; otherwise SES, through the `SES_*` account |
| `OBJECT_STORAGE`               | `local`: files under `temp/`          | local under `NODE_ENV` development or test; otherwise the bucket in `S3_*`            |
| `REDIS_KEY_PREFIX`             | empty; `wt:<worktree>:` in a worktree | no prefix                                                                             |
| `SES_*`                        | unset                                 | needed only by SES; the fake reads none                                               |
| `CF_*`, `STRIPE_*`, `GITHUB_*` | unset                                 | no Cloudflare DNS, every Plan limit unlimited, no GitHub sign-in                      |

`bun run dev` sets `NODE_ENV=development`, so the fake and local storage are the defaults there even without the first two lines. Both refuse to start under `NODE_ENV=production`.

`TEMPLATING_BUILDER_SECRET` connects web to the builder; without it the Template catalog works but Email Workspaces don't. `BETTER_AUTH_SECRETS` signs sessions and seals DKIM keys.

## The fake email backend

With `EMAIL_BACKEND=fake` (`packages/provider-aws/src/email/fake.ts`) nothing reaches AWS. The fake accepts a send and returns a `fake-…` message id, so its Delivery ends `sent`. Adding a Domain makes no SES identity, and the Domain verifies at once without a DNS lookup. The worker makes no SES or SNS infrastructure at startup, and logs each send and each outcome.

Outcomes arrive a moment after the send, through the same ingest SES's notifications reach, so delivery events, suppression and Webhook Events behave as they would. The fake never pauses sending, so a Project Sending Pause can't be reproduced with it. Recipients are SES's mailbox simulator addresses, which act the same against real SES:

| Recipient                           | Outcome                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `success@simulator.amazonses.com`   | delivered                                                                                                       |
| `bounce@simulator.amazonses.com`    | hard bounce: the Contact is suppressed for everything; later sends leave it out, and one to it alone is refused |
| `complaint@simulator.amazonses.com` | delivered, then a complaint: the Contact is suppressed for marketing                                            |
| any other address                   | delivered (nothing is sent to it)                                                                               |

The fake ignores a `+label` after the mailbox (`bounce+signup@…`), as SES does.

## Worktrees

Set up the main checkout as above. `bun run worktree:setup` sets up every other git worktree. It writes the worktree's `.env` from `.env.example`, never from another checkout's, with fresh secrets and the worktree's own:

- database, `relayit_wt_<worktree>`, on a Postgres 18 kept for worktrees: `postgres://postgres:postgres@localhost:5433`, Ted's `postgres` container. Set `WORKTREE_POSTGRES_URL` to use another;
- ports, the next free block of a hundred from 3100 (dashboard at the block's base, site +1, api +5, builder +6);
- Redis key prefix, `wt:<worktree>:`, on the Redis in `.env.example`;

then installs, migrates and seeds. Run again, it keeps all three; `--reset` drops the database and the prefix's Redis keys first.

Setup comments each database with its worktree's path; `bun run worktree:prune` (`--dry-run` to list) drops those whose worktree is gone, with their Redis keys, and nothing else. In the main checkout, setup changes nothing.

Browsers keep cookies per host, not per port, so signing in to one checkout on `localhost` signs you out of another; use a second browser profile to keep two signed in.

In T3 Code, the project's actions run these:

| Action          | Command                              |                                 |
| --------------- | ------------------------------------ | ------------------------------- |
| Setup           | `bun run worktree:setup`             | runs when T3 creates a worktree |
| Dev             | `bun run dev`                        |                                 |
| Check           | `bunx vp check && bun run typecheck` |                                 |
| Test            | `bun run test`                       |                                 |
| Prune databases | `bun run worktree:prune`             | after removing worktrees        |

## Tests

`bun run test` (`tooling/scripts/src/test.ts`) starts a throwaway Postgres 18 and Redis 7 in Docker, migrates the database, runs every package's tests against them with the integration tests on, removes the containers, and lists every package that failed. CI runs the same command. Set both `TEST_DATABASE_URL` and `TEST_REDIS_URL` to use your own instead; a test may write anything to them.

Tests are Vitest, run through Vite+ under Bun: each package's `test` script is `bun --bun vp test run` with the root `vite.config.ts`, which resolves `@repo/*` through the packages' tsconfig paths as Bun does. Under plain `vp test` Vitest would run on Node, where Bun's Redis client, `Bun.spawn` and `Bun.build` don't exist. Run alone (`bun run test <file>` in a package), a Postgres or Redis integration test skips unless those two are set.

## Schema changes

Change `packages/persistence/src/db/schema/` (or the jobs package's `*-schema.ts`), run `bun run db:generate`, and read the generated SQL. It loads the root `.env` for Drizzle's config but doesn't connect. `bun run db:migrate`, or the next start of the api, web or builder, applies it; the worker never migrates. If generate asks whether a column was renamed, or fails for want of a TTY, ask Ted to run it. Never edit a generated migration; if one is wrong before it merges, delete its folder and generate again.
