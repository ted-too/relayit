# Overview

How Relayit is put together, and why. [AGENTS.md](../../AGENTS.md) has the glossary and the rules; this page has the decisions behind the shape of the code.

## Shape

```
customer's code ── x-api-key ──► apps/api (Elysia) ── POST /messages/email, /send/*
                                   │  accept: Message + Delivery + job, one transaction
                                   │                    │
                                   │              Postgres outbox ──► Redis Streams
                                   │                                        │
                                   └─ job worker (same process) ◄───────────┘
                                        ├─► SES (packages/provider-aws) ─► recipient
                                        └─► customer's Webhook Endpoints
SES ── SNS ──► apps/api /webhooks/providers/... ─► bounces, complaints, Suppression

browser ──► apps/web (TanStack Start) ── server functions, better-auth
                │                          └─► Postgres, Redis, SES, Cloudflare DNS
                └── Effect Rpc + shared secret ──► apps/template-builder ─► S3 (Git objects, artifacts)

apps/site: marketing site and public docs
```

The three apps share one Postgres and one Redis. The domain lives in `packages/*`, which the apps import through explicit subpaths; an app never imports another app's source.

## Decisions

### Three deployables, one database

Template building installs npm packages and runs builds, so it has its own process and lifecycle (`apps/template-builder`) that only web calls. Public ingress and background work share one runtime (`apps/api`) because they are one operational concern: the same composition root owns the Elysia server and the worker fibers. The cost, accepted, is that API and worker capacity scale together and fail together. In production on Linux the api forks `WEB_CONCURRENCY` HTTP children and runs the worker only on the primary.

Everything a signed-in user does (Projects, members, API keys, Domains, Providers, Templates) is a web server function, so the api has no session surface at all: it authenticates API keys only, and each key resolves to one Project.

All apps share one database and one migration history, in `packages/persistence/drizzle/`, aggregated from the persistence schema and the jobs package's tables. Each app applies pending migrations on start under a Postgres advisory lock, so whichever starts first migrates and the others wait, then find nothing to do.

### Work crosses processes as typed jobs

A job's contract (`defineJob`: name, payload schema, retry and dead-letter policy, recurrence) belongs to its domain package, next to its handler. Web and the api import contracts and enqueue; only the api's worker imports and registers handlers, so producing a job never decides where it runs. An HTTP handler never does delivery or infrastructure work itself.

A job that depends on rows being written is enqueued through the Postgres outbox in the same transaction, so a send is never accepted without its delivery job, nor a job left pointing at rows that rolled back. The outbox publishes to Redis Streams; a crashed worker's claims are reclaimed after a minute; a job that exhausts its retries is dead-lettered in Postgres.

### `/messages/email` is Resend-compatible

Transactional email is sent with `POST /messages/email`, shaped like Resend's send-email API so a Resend client can point at Relayit with minimal change. Relayit-only fields may be added, never required. It creates a transactional Message and one email Delivery; it is not a second concept and never sends marketing. Two incompatibilities are deliberate: `topic_id` is rejected, because Topic consent belongs to Campaign sends; and webhook event types are channel-agnostic (`message.sent`, `delivery.skipped`), not Resend's `email.*`. The categories match (delivery outcomes, Domain and Contact lifecycle); the names don't. The legacy `/send/*` stays for existing integrations.

### Accept, then deliver

Accepting a send is synchronous and cheap: validate, drop recipients suppressed at severity `all` (the response lists them), reserve Usage, then write the Message, its Delivery, its Contacts and the delivery job in one transaction. If that transaction fails, the Usage reservation is released. An `Idempotency-Key` header makes a retried request within 24 hours return the original Message rather than send twice.

The worker checks suppression again before sending, since a bounce may have landed in between. A Delivery whose recipients are all suppressed ends `skipped`; one that cannot be sent ends `failed` with its reason. Each outcome emits its webhook event in the transaction that records it.

### SES tenant per Project

All Projects on a managed SES account share that account's bounce and complaint rates, so one Project mailing a stale list could get the account paused and stop everyone's mail. Managed sends therefore go through an SES tenant per Project (`relayit-<projectId>`, derived, not stored), with SES's Standard reputation policy pausing only that tenant. The worker ensures the tenant on a Project's first send in each process: it creates the tenant and associates the Domain identity and the shared configuration set. A Domain identity is detached from its tenants before it is deleted, since SES refuses to delete an associated one.

Ensuring the tenant fails open: if it fails (IAM lacking `ses:*Tenant*`, say), the send goes out untenanted and the next send tries again. A `SendingPausedException` is a Project Sending Pause only when `GetTenant` reports the tenant `DISABLED`; otherwise it is the whole account paused. BYO Providers send untenanted: the account is the customer's, so a tenant would isolate no one. Unpausing a tenant in SES does not yet unpause the Domain.

Per-Project configuration sets were rejected because they give metrics but no enforcement; a Relayit-side bounce-rate breaker because it rebuilds what SES's reputation policies already do, without changing how SES attributes reputation.

### Setup assistance, not a provider proxy

Relayit helps a Project finish the setup a vendor needs before it can send, and stops there; it does not proxy the vendor's control plane, which was too much work for what customers need. For email that means Relayit generates the Domain's DKIM key (BYODKIM), registers it with SES, and lists the DNS records the customer publishes, then polls until they verify. The Sandbox Domain's records are on Relayit's own Cloudflare zone, so Relayit publishes them itself.

### Provider credentials and DKIM keys are sealed

Provider credentials and DKIM private keys are encrypted at rest with `BETTER_AUTH_SECRETS`, the same versioned secrets better-auth signs with. The list form (`2:new,1:old`) seals with the first and opens with any, so a secret can be rotated without re-encrypting every row first.

### Outbound webhooks

- An event and its delivery jobs commit in the same transaction, through the outbox.
- No event is stored when no enabled Endpoint subscribes to it; a disabled Endpoint accumulates nothing, but disabling it doesn't cancel deliveries already accepted.
- Delivery is at least once, in no particular order. Receivers deduplicate on the `webhook-id` header.
- A delivery being attempted is claimed with a lease, so a crashed worker can't strand it.
- A signing secret is shown only when created or rotated; the previous one keeps verifying for a bounded window after rotation.
- Only a dead-lettered delivery can be replayed, and only while its Endpoint is enabled; attempt counts carry across replays.

### Templates render sealed artifacts

A Template is the send catalog; code-backed engines such as React Email are not Templates but Workspace Entries a Template's email variant links by id. A primitive variant (subject, HTML, text, flat variables with fallbacks) is live as soon as it is saved. Handlebars-style logic at save time was rejected because real templates need arrays and conditionals.

An Email Workspace's source is Git stored in object storage: content-addressed objects in S3, branch refs in Postgres, a lock per workspace, throwaway worktrees for each build, so no volume is needed. Authors edit `dev`; Publish installs dependencies (public npm only) and builds in the template builder, seals each Entry into an artifact in object storage, and advances `main` only if every step succeeded. The builder is the only thing that mutates workspace Git. A send renders the sealed artifact in a constrained isolate; it never runs workspace source. Workspace kinds are a static registry in `packages/templating/src/kinds/`, so a future engine reuses the same build, seal and render path.

### Cloud and self-hosted run the same code

Plans and Usage limits come from Stripe through better-auth's Stripe plugin. Without the Stripe keys, every limit is unlimited and billing disappears: that is the self-hosted edition, not a separate build.

### React's `use-sync-external-store` shim in SSR

Nitro's bundled server can keep a runtime `require("react")` inside CommonJS it inlines from `use-sync-external-store/shim` (via `@base-ui/utils`), which loads a second React or none. `apps/web` and `apps/site` resolve the shim to ESM that imports the bundled React (`vite/resolve-use-sync-external-store-from-react.ts`), and the web image sets `NODE_ENV=production`. Delete the plugin once our Nitro version ships `experimental.cjsRequireRewrite`.

## Migrations

`packages/persistence/drizzle.config.ts` reads the schema from `packages/persistence/src/db/schema/` and the jobs package's two table files, and writes `packages/persistence/drizzle/<timestamp>_<name>/`. Generate with `vp run --filter @repo/persistence db:generate`; the config insists on a `DATABASE_URL` but generating never connects. Apps apply migrations on start (`packages/persistence/src/db/migrate.ts`); production images find them through `DRIZZLE_MIGRATIONS_FOLDER`.

## Being removed

Ted has decided these go. They are still in the code; don't build on them.

- **Pluggable providers.** SES is the only email vendor; the provider registry and the `vendor.product` type ids (`aws.ses`, the `:vendorId/:productId` webhook path) go.
- **BYO Providers.** A deployment's SES accounts become ops-only backends, possibly one per region, with no customer-owned credentials, and the BYO Plan limits and pricing with them.
- **Multi-provider Domains.** A Domain belongs to exactly one backend: pairings with several Providers, failover between them, the provider circuit and switching a Domain's Provider go, as does choosing a Provider when creating a Domain.
- **The worker in `apps/api`.** It moves into its own `apps/worker`.
- **portless and `bun test`.** Dev servers stop going through portless; tests move to Vitest with their own Postgres and Redis.
