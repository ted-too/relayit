# Relayit

Relayit is a multi-tenant messaging platform: a Project sends through Relayit's API, and Relayit delivers, retries, tracks bounces and complaints, and tells the Project what happened through its webhooks. Email through AWS SES is the only live channel. It runs as Relayit's cloud, metered against Stripe plans, or self-hosted from the published images with no limits.

## Non-negotiables

1. **An accepted send is delivered or fails visibly.** Once the API has answered with ids, the Delivery ends `sent`, `failed`, `skipped` or `canceled` with its reason, and a Project with a Webhook Endpoint hears about it. Nothing is dropped silently or left stuck in `queued`.
2. **A suppressed or unsubscribed address is never sent to.** Suppression is checked when a send is accepted and again just before it goes out; an unsubscribe applies to every marketing send it covers.
3. **One Project never sees or changes another's data.** Every query a request makes is scoped to the Project its API key or session resolved to, and one Project's bounces and complaints never pause another's mail.
4. **Never touch production data or real cloud accounts** (the production database, AWS, Cloudflare, Stripe, the container registry) unless Ted explicitly allows it for that task. Local and test databases are yours.
5. **Evidence before claims.** It is not working until a test or a run shows it.

## A note from Ted

I care about the thing actually working for the people sending through it and the people receiving what they send. Take the complete path, not the quick one; if something is big, say so and do it, don't quietly shrink it. Prefer the smallest design that makes the right behaviour obvious, and inline logic where it is used: no single-use helpers or wrappers that only forward to another function. Reach for a dependency when it is excellent and alive.

When a choice is ambiguous, take the conservative option, keep going, and flag it at the end. Bad patterns near your task: flag them, don't fix them unasked. If a rule here fights the task in front of you, say so loudly and get my sign-off before breaking it.

## Glossary

- **we**: Ted and you. **you**: the agent reading this.
- **Project**: the tenant, and the boundary every customer-owned row hangs off. It is a better-auth organization, so code and routes say `organization`, `organizationId` and `orgSlug`; the product says Project. Members have roles; API keys belong to a Project.
- **App Environment**: an optional `app` and `environment` named on a send, partitioning a Project's Contacts and Messages. A send that names neither uses the Project's default one.
- **Message**: one logical send, transactional or marketing (its **purpose**). **Delivery**: a Message's attempt on one channel, holding the content, the From, the status and the Provider used. The Provider retries a soft bounce; Relayit never makes a new Delivery for it.
- **accept**: the synchronous part of a send: validate, strip suppressed recipients, reserve Usage, then write the Message, its Delivery and the delivery job in one transaction. Everything after happens in the worker.
- **Contact**: an address within an App Environment, made or updated on every send to it. Deleting one is soft, so its Suppression and unsubscribes survive.
- **Suppression**: a Contact Relayit must not send to, from a hard bounce, a complaint or by hand. Severity `all` stops every send to it, `marketing` only marketing.
- **Topic**: a Project's marketing consent category. **Unsubscribe**: a Contact opting out of one Topic or of all marketing; never of transactional mail. **Segment**: a static list of Contacts a Campaign targets; leaving it is not unsubscribing.
- **Campaign**: a marketing send's definition: a Topic, a Template and a From per channel. Modelled, not sent yet.
- **Template**: a Project's catalog entry for send content, with a variant per channel. An email variant is either primitive (subject, HTML, text, simple variables) or links a **Workspace Entry**: one email in an **Email Workspace**, a Project's React Email source. **Publish** builds the workspace and seals each Entry into the artifact sends render.
- **Provider**: credentials for an upstream vendor product; today only AWS SES. **Managed** Providers are the platform's, wired by ops, one of them the default; **BYO** Providers belong to one Project. The admin UI and the `integration` permission call them integrations.
- **Domain**: a customer's sending FQDN, held by one Project at a time; another Project takes it over by proving DNS ownership (a **claim**). Relayit generates its DKIM key and gives the DNS records to publish. Its registration on a Provider is a **provider identity**: one active, others failover-eligible.
- **Sandbox Domain**: the platform's shared sending root on Relayit's Cloudflare zone. A new Project is given it so it can send before verifying a Domain, to its own members only.
- **paused Domain**: a Domain that may not send, for its reputation or by hand. New sends from it are rejected and queued ones fail; they are never held. **Project Sending Pause**: SES pausing one Project's tenant for its reputation. A send that hits one fails for good (no retry, no failover) and pauses the Domain; other Projects keep sending.
- **Usage**: one Delivery counted against the Plan limits of the Project's **Billing User** (the owner unless reassigned), split by purpose and by managed or BYO. Reserved at accept, released if the accept fails. **Plan**: `free`, `signal` or `broadcast`, from Stripe; without Stripe keys every limit is unlimited.
- **Webhook Endpoint**: a Project's URL that receives the **Webhook Events** it subscribes to (`message.sent`, `delivery.skipped`, `domain.updated`, …), signed, at least once. Not to be confused with **provider notifications**: SES's bounce, complaint and delivery reports arriving at `/webhooks/providers/...`.
- **job**: a typed unit of background work defined with `defineJob` in its domain package; the api's worker runs every handler.
- **admin**: a platform operator (better-auth's admin role), with the `/admin` pages: managed Providers, users, Projects.

## Ways to hurt yourself

1. **Production data and real cloud accounts.** Production's database holds customers' Projects, credentials and send history; AWS and Cloudflare hold live sending infrastructure. Never point a dev server, script, migration or test at them, or call their APIs, without Ted's permission for that task.
2. **Starting an app.** Every app migrates its `DATABASE_URL` as it starts, and the api's job worker sends whatever is queued. What else it reaches depends on the root `.env`:
   - **Safe:** a `.env` written by `bun run worktree:setup`, or copied from `.env.example`. `EMAIL_BACKEND=fake` sends nothing and makes nothing in AWS, Domains verify without AWS or public DNS, objects stay in `temp/`, Redis keys carry the worktree's prefix, and with no `CF_*`, `STRIPE_*` or `GITHUB_*` nothing calls Cloudflare, Stripe or GitHub.
   - **Not safe:** the main checkout's `.env`, or any `.env` with `EMAIL_BACKEND=ses`, a cloud key or a database you didn't make. With SES the api decrypts every email Provider's AWS credentials, points SES and SNS at its `API_URL` and sends queued mail for real, and adding a Domain creates real SES identities. Don't start an app or `bun run dev` against one unless Ted asks for that run.
3. **Killing by pattern.** Never `pkill -f`, `killall`, or kill a PID found by matching a name or path; other dev servers and agents run on this machine. Kill only a PID you started. Killing only the PID of a background `bun run dev` leaves its apps running, so kill every PID in its process tree.
4. **Migrations.** Never hand-write or edit anything under `packages/persistence/drizzle/`. Change the schema (`packages/persistence/src/db/schema/`, plus the jobs tables in `packages/jobs/src/*-schema.ts`), then run `bun run db:generate` and read the SQL. If generate asks a question (rename or create) or fails for want of a TTY, stop and ask Ted to run it; never feed it keypresses or write the files yourself.
5. **Secrets.** The main checkout's `.env` files hold real credentials. Never commit, print, paste, copy or edit them; name the variable instead. A worktree's `.env` holds only generated local secrets.

## How it works

Three deployables share one Postgres and one Redis. `apps/web` is a TanStack Start app: the dashboard, better-auth at `/api/auth/*`, and every session-authenticated operation as a server function. `apps/api` is an Elysia server for API-key traffic (`POST /messages/email`, the legacy `/send/*`, SES notifications, `/health`, `/docs`), and in the same process the job worker. `apps/template-builder` builds and publishes Email Workspaces; only web calls it, over Effect Rpc with a shared secret. `apps/site` is the marketing site and public docs.

The domain lives in packages the apps import through explicit subpaths (`@repo/channels/email/delivery`): `channels` holds accept, delivery, Domains, Providers and Usage; `webhooks` the outbound events; `jobs` the queue (Redis Streams, with a Postgres outbox so a job is enqueued in the same transaction as the rows it acts on). Code reaches Postgres through Drizzle v1 on `@effect/sql-pg`, SES through `packages/provider-aws`.

Architecture, decisions and their reasons: [docs/internals/overview.md](docs/internals/overview.md).

## Where code lives

```
apps/api/                 Elysia ingress + job worker (one process)
apps/web/                 TanStack Start dashboard, better-auth, server functions
apps/template-builder/    Email Workspace build and publish, Effect Rpc
apps/site/                marketing site; public docs in content/
packages/channels/        accept, delivery, Domains, Providers, Usage
packages/persistence/     Drizzle schema, migrations, DB layer, auth, credential sealing
packages/jobs/            job contracts, worker, outbox, dead letters
packages/webhooks/        Webhook Events, Endpoints, signed delivery
packages/provider-aws/    the SES adapter
packages/templating/      Email Workspaces: Git in S3, publish, the builder's Rpc
packages/template-render/ rendering primitive and sealed React Email templates
packages/redis/, object-storage/, logging/, ui/   infrastructure and shared UI
tooling/oxlint-plugin/    our lint rules, each with a test
tooling/scripts/          dev env, worktree setup and prune, seed, the test runner
docs/internals/           decisions and constraints that span components
docs/operations/          procedures: development, deploys
temp/                     scratch (gitignored)
```

Apps never import another app's source; shared behaviour belongs in a package.

## Commands

Bun installs and runs the apps; Vite+ (`vp`) runs lint, format and the workspace's scripts. Lint and format config is in the root `vite.config.ts`.

- `bun install`: also patches `tsc` with the Effect language service and installs the commit hook.
- `bun run dev`: all four apps, reading the root `.env`: dashboard on `WEB_PORT`, site `SITE_PORT`, api `API_PORT`, builder `BUILDER_PORT` (3000, 3001, 3005, 3006 in the main checkout). Read Ways to hurt yourself first. Setup: [docs/operations/development.md](docs/operations/development.md).
- `bun run db:migrate`, `bun run db:seed`: migrate and seed the root `.env`'s local database; the seed prints how to sign in and an API key.
- `bun run db:generate`: a migration from the schema. Apps apply migrations when they start.
- `bun run worktree:setup` (`--reset`), `bun run worktree:prune` (`--dry-run`): see Worktrees.
- `vp lint <files>`, `vp run --filter <pkg> test`, `vp run --filter <pkg> typecheck`, `bun test <file>` inside a package: targeted checks.
- `vp check` (format + lint, `--fix` to fix), `bun run typecheck`, `bun run test`, `bun run build`, `bun run knip`: repo-wide.

Tests run on `bun test`, except `packages/template-render` and `tooling/oxlint-plugin` (Vitest). `bun run test` needs Docker and no `.env`: it starts a throwaway Postgres and Redis, runs every package's tests with the integration tests on, and reports every failing package; CI runs it the same way. Run alone, an integration test skips unless `TEST_DATABASE_URL` and `TEST_REDIS_URL` are set; point them at a database and Redis you can throw away.

The commit hook formats and lints staged files and blocks the commit on a lint error. Lint as you go rather than finding out at commit.

## Worktrees

Each task gets its own git worktree: T3 Code makes it under `~/.t3/worktrees/` and runs `bun run worktree:setup` in it. That writes the worktree's root `.env` from `.env.example` with fresh secrets, its own database (`relayit_wt_<worktree>`, on the worktrees' Postgres at `localhost:5433`), its own block of ports and its own Redis key prefix (`wt:<worktree>:`), then installs, migrates and seeds. Run it yourself if the worktree has no `.env`. If that Postgres isn't running, setup says so: ask Ted to start it rather than pointing the worktree at another.

- **Your database, ports, prefix and `temp/` are yours alone**; `db:*` and `bun run dev` use them. `bun run test` starts its own Postgres and Redis.
- **Never copy the main checkout's `.env`** into a worktree, or add a cloud key to one. Ask Ted if a task needs a real account.
- **Branch names.** T3 names a new branch `t3code/…`. Rename it to `<type>/<slug>` (`git branch -m`) before the first push.
- **A branch is checked out in one worktree at a time.** A stack's layers live in the worktree that made it; `gh stack` moves between them there.
- **Migrations made in parallel.** If `main` gains a migration while yours is unmerged, rebase, delete your migration folder, run `bun run db:generate` again, then `bun run worktree:setup --reset`.
- Removed worktrees leave their databases and Redis keys behind; `bun run worktree:prune` drops those, and only those.

## Code

- **Effect.** Effect 4. Services are `Context.Service` classes; errors are `Data.TaggedError` (`Schema.TaggedError` where they cross an Rpc). Run effects only at app edges: the api's composition root, a web server function through `runApp`, the builder's Rpc server.
- **Errors.** Construct a tagged error where it is raised, with a static `message` and the varying data in fields; lint enforces both. Classify failures with a `switch` on `_tag` listing what is retryable, `default` terminal, rather than an `isX` guard or `instanceof`. Map a shared function's error where you call it; don't wrap it under a new name to remap it.
- **Services.** Take the service at the call site (`const usage = yield* Usage`) and call it; no helper that only yields a service and forwards one method.
- **Jobs.** A job's contract and handler live in their domain package. Producers enqueue in the transaction that writes the rows the job reads; only `apps/api` registers handlers.
- **Schemas.** Zod for the web app's env, forms and server-function inputs; Effect Schema for job payloads, Rpc and config. Use the one the module around you uses.
- **Types.** Inferred over annotated; `satisfies` over `as`. Never cast away an Effect's requirements.
- **Comments** say why, not what, and move with the code. No narration ("added X").
- **Lint suppressions** need a reason: end the directive with `-- reason` or put a comment on the line above.
- **No compatibility code** for our own old formats: change a key or shape outright and say in the PR what was dropped. The Resend-shaped `/messages/email` and the legacy `/send/*` are customer contracts, not our formats: change them only on purpose.

## Before calling it done

- **Checks.** Run lint, typecheck and tests for what you changed. CI runs everything; the push is how it runs.
- **Tests.** Logic and observable behaviour get tests: accept and delivery outcomes, suppression, Usage, webhook signing and delivery. Use a real Postgres or Redis for integration tests, with fakes only at true boundaries (SES, Cloudflare, the clock). Don't mock the logic under test.
- **UI.** Dashboard changes need screenshots in the PR. Take them against a local database and fake data, never a running instance with real Projects.
- **Done** is a PR open on GitHub with CI green.

## Git and PRs

- Branch per change, `<type>/<slug>`, from and targeting `main`. Ted merges; PRs are squash-merged, so once a branch's PR has merged, new work goes on a new branch from `main`, opened as a new PR.
- Conventional commits scoped by area: `feat(send):`, `fix(domains):`, `chore(tooling):`, `docs(internals):`, `ci:`. The PR title becomes the squash commit, and semantic-release reads it on `main`: `feat`, `fix`, `perf`, `refactor` and `revert` cut the next `1.0.0-alpha.N` and publish images; `docs`, `chore`, `test`, `build`, `ci` and `style` release nothing. Pick the type for what the change does to a running deployment.
- PR body: the problem in a sentence or two, then `## Changes`, `## Verified` (the tests and runs that prove it), `## Decided without Ted` (judgment calls you made, so he can overrule them) and `Closes #N` for each issue it settles.
- Never commit plans, scratch files or screenshots for PRs; upload evidence to the PR. `gh pr create`, `gh pr edit` and `gh pr comment` take `--attach <file>`: reference each image in the body by the exact path given to `--attach`, written out in full, and `gh` rewrites it to the uploaded URL. Read the body back with `gh pr view <n> --json body` and check every image became a `user-attachments` URL.
- **Stack dependent work.** When a change lands in layers that each make sense to review alone, make it a stack with `gh stack`: `gh stack init --base main <branch>`, `gh stack add <branch>` for each layer, `gh stack submit` to push and open the PRs as a linked stack, `gh stack sync` after changing a lower layer. Each layer targets the one below and is merged from the bottom. Work that doesn't depend on another open PR is its own PR off `main`.
- **Review fixes on a stack** go in a new layer on top, one commit per fix, so the reviewed layers below stay as they were.

## Issues

An issue is work a PR leaves behind: a bug, a behaviour wanted, an unknown to settle, a tidy-up. Open one whenever you defer something, and name the PR it came from. Code points at issues as `#N` in a comment; there are no FIXME or TODO comments.

- Title: `<area>: <what's wrong or wanted>`, in the glossary's terms.
- Body: the template for its type in `.github/ISSUE_TEMPLATE/`. **Done when** names the test or the check that proves it.
- Labels (`gh label list` says what each means):
  - type, exactly one: `bug`, `feature`, `research`, `refactor`;
  - priority, exactly one: `p0` (a non-negotiable is at risk; next), `p1` (needed soon), `p2` (wanted, could slip), `later` (not planned yet);
  - `area: <area>` for each area it touches: `send`, `domains`, `ses`, `contacts`, `webhooks`, `templates`, `jobs`, `auth`, `billing`, `dashboard`, `site`, `ci`, `tooling`. Add an area when one is first needed;
  - `needs: ted` only when it waits on Ted: a decision, an account, or production access.
- An issue that is split or overtaken is closed with a comment naming where its work went.

## Documentation

Most changes need no doc change; agents can read the code.

- `docs/internals/` holds decisions and their reasons, constraints that span components, and traps the source doesn't reveal. Before adding a paragraph, ask what a maintainer would get wrong without it. Don't enumerate fields, narrate control flow or append PR summaries.
- `docs/operations/` holds procedures: development setup, deploys.
- `apps/site/content/docs/` is the public documentation; a change to the public API or self-hosting changes it in the same PR.
- `docs/v1/` (gitignored, in Ted's checkout only) holds product strategy; read it for intent, not as a description of the code.
- A local reason goes in a code comment; one that crosses components goes in `docs/internals/`.
- When a decision changes, rewrite the text; don't append a second account.
