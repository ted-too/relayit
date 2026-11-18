# Overview

How Relayit is put together, and why. [AGENTS.md](../../AGENTS.md) has the glossary and the rules; this page has the decisions behind the shape of the code.

## Shape

```
customer's code ── x-api-key ──► apps/api (Elysia) ── POST /messages/email, /send/*
                                   │  accept: Message + Delivery + job, one transaction
                                   ▼
                             Postgres outbox ──(relayed by the worker)──► Redis Streams
                                                                              │
                                   apps/worker (no HTTP): every job handler ◄─┘
                                        ├─► SES (packages/provider-aws) ─► recipient
                                        └─► customer's Webhook Endpoints
SES ── SNS ──► apps/api /webhooks/providers/aws/ses ─► bounces, complaints, Suppression

browser ──► apps/web (TanStack Start) ── server functions, better-auth
                │                          └─► Postgres, Redis, SES
                └── Effect Rpc + shared secret ──► apps/template-builder ─► S3 (Git objects, artifacts)

apps/site: marketing site and public docs
```

The four apps share one Postgres and one Redis. The domain lives in `packages/*`, which the apps import through explicit subpaths; an app never imports another app's source.

## Decisions

### Four deployables, one database

Template building installs npm packages and runs builds, so it has its own process and lifecycle (`apps/template-builder`) that only web calls. Public ingress (`apps/api`) and background work (`apps/worker`) are separate deployables too. They began as one process, and that was a mistake: request capacity and worker capacity scaled together and shared a failure domain, so a crash, or a burst of delivery work, hit the API too. Now each scales and fails alone; the price is a service to deploy, and a deployment without the worker accepts sends that queue and never go out.

The api runs one process per replica and scales with replicas, not by forking: its `node:cluster` mode existed to keep the worker on one primary, never ran in production (it needed `NODE_ENV=production`, which the images don't set), and went with the worker. Several workers are safe: they share one Redis consumer group, and a dead one's claims are reclaimed after a minute.

Everything a signed-in user does (Projects, members, API keys, Domains, Templates) is a web server function, so the api has no session surface at all: it authenticates API keys only, and each key resolves to one Project.

All apps share one database and one migration history, in `packages/persistence/drizzle/`, aggregated from the persistence schema and the jobs package's tables. The api, web and builder each apply pending migrations on start under a Postgres advisory lock, so whichever starts first migrates and the others wait, then find nothing to do. The worker never migrates: it assumes a current schema, so a deploy that adds a migration rolls out the api before the worker.

### Work crosses processes as typed jobs

A job's contract (`defineJob`: name, payload schema, retry and dead-letter policy, recurrence) belongs to its domain package, next to its handler. Web and the api import contracts and enqueue; only `apps/worker` imports and registers handlers, so producing a job never decides where it runs. An HTTP handler never does delivery or infrastructure work itself.

A job that depends on rows being written is enqueued through the Postgres outbox in the same transaction, so a send is never accepted without its delivery job, nor a job left pointing at rows that rolled back. The outbox publishes to Redis Streams; a crashed worker's claims are reclaimed after a minute; a job that exhausts its retries is dead-lettered in Postgres.

### `/messages/email` is Resend-compatible

Transactional email is sent with `POST /messages/email`, shaped like Resend's send-email API so a Resend client can point at Relayit with minimal change. Relayit-only fields may be added, never required. It creates a transactional Message and one email Delivery; it is not a second concept and never sends marketing. Two incompatibilities are deliberate: `topic_id` is rejected, because Topic consent belongs to Campaign sends; and webhook event types are channel-agnostic (`message.sent`, `delivery.skipped`), not Resend's `email.*`. The categories match (delivery outcomes, Domain and Contact lifecycle); the names don't. The legacy `/send/*` stays for existing integrations.

### Accept, then deliver

Accepting a send is synchronous and cheap: validate, drop recipients suppressed at severity `all` (the response lists them), reserve Usage, then write the Message, its Delivery, its Contacts and the delivery job in one transaction. If that transaction fails, the Usage reservation is released. An `Idempotency-Key` header makes a retried request within 24 hours return the original Message rather than send twice.

The worker checks suppression again before sending, since a bounce may have landed in between. A Delivery whose recipients are all suppressed ends `skipped`; one that cannot be sent ends `failed` with its reason. Each outcome emits its webhook event in the transaction that records it.

### SES tenant per Project

All Projects on the platform's SES account share that account's bounce and complaint rates, so one Project mailing a stale list could get the account paused and stop everyone's mail. Sends therefore go through an SES tenant per Project (`relayit-<projectId>`, derived, not stored), with SES's Standard reputation policy pausing only that tenant. The worker ensures the tenant on a Project's first send from a region in each process: it creates the tenant there and associates the Domain identity and the shared configuration set. A Domain identity is detached from its tenants before it is deleted, since SES refuses to delete an associated one.

Ensuring the tenant fails open: if it fails (IAM lacking `ses:*Tenant*`, say), the send goes out untenanted and the next send tries again. A `SendingPausedException` is a Project Sending Pause only when `GetTenant` reports the tenant `DISABLED`; otherwise it is the whole account paused. Unpausing a tenant in SES does not yet unpause the Domain.

Per-Project configuration sets were rejected because they give metrics but no enforcement; a Relayit-side bounce-rate breaker because it rebuilds what SES's reputation policies already do, without changing how SES attributes reputation.

### Setup assistance, not a provider proxy

Relayit helps a Project finish the setup a vendor needs before it can send, and stops there; it does not proxy the vendor's control plane, which was too much work for what customers need. For email that means Relayit generates the Domain's DKIM key (BYODKIM), registers it with SES, and lists the DNS records the customer publishes, then polls until they verify. The Sandbox Domain's records are on Relayit's own Cloudflare zone, so Relayit publishes them itself.

### One SES account, configured by ops

A deployment sends through one SES account, named in the environment of web and the worker (`SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGIONS`); the database holds no vendor credentials and customers bring none. Code sends and registers through the `EmailBackend` service (`packages/channels/src/email/backend.ts`), implemented for SES and for the fake in `packages/provider-aws`. Pluggable providers, Project-owned credentials and Domains paired with several providers were removed: each multiplied the paths a send could take for customers who never asked for them.

The account can span several regions, so a later channel can route by destination without the customer choosing; email uses that only to place Domains. A Domain is registered in one region, the first of `SES_REGIONS` when it is added, recorded on its registration (`email_domain_provider_identity`, a name kept so its rows did not have to move), and always sent through that region: there is no failover between regions. A registration with no recorded region predates regions and is in the default one, so the first entry of `SES_REGIONS` must stay the region those Domains were registered in. A send SES refuses for any reason but a Project Sending Pause is retried with backoff; when the retries run out the Delivery fails with that reason.

At startup the worker creates, in every region, the configuration set each send names and an SNS topic subscribed to the api's SES notification URL. The resources are named after that URL, so a restart with the same URL finds them and changes nothing; that is also why the URL keeps its old `/webhooks/providers/aws/ses` shape.

### DKIM keys are sealed

DKIM private keys are encrypted at rest with `BETTER_AUTH_SECRETS`, the same versioned secrets better-auth signs with. The list form (`2:new,1:old`) seals with the first and opens with any, so a secret can be rotated without re-encrypting every row first.

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

### Development runs with nothing real behind it

`EMAIL_BACKEND=fake` replaces SES with a stand-in (`packages/provider-aws/src/email/fake.ts`): it accepts sends, verifies identities and Domain records at once without AWS or public DNS, and reports outcomes for SES's mailbox simulator addresses through the same ingest SES notifications reach, so suppression and Webhook Events behave as they would. It needs none of the `SES_*` variables. `OBJECT_STORAGE=local` keeps objects under the checkout's `temp/`, and `REDIS_KEY_PREFIX` puts every Redis key under a prefix, better-auth's sessions included, so checkouts sharing one Redis never take each other's jobs.

Left unset, the fake and local storage are chosen only when `NODE_ENV` is `development` or `test`. The api, worker and builder images set no `NODE_ENV`, so an unset one has to keep meaning SES and S3; the fake and local storage refuse to start under `production`.

### React's `use-sync-external-store` shim in SSR

Nitro's bundled server can keep a runtime `require("react")` inside CommonJS it inlines from `use-sync-external-store/shim` (via `@base-ui/utils`), which loads a second React or none. `apps/web` and `apps/site` resolve the shim to ESM that imports the bundled React (`vite/resolve-use-sync-external-store-from-react.ts`), and the web image sets `NODE_ENV=production`. Delete the plugin once our Nitro version ships `experimental.cjsRequireRewrite`.

## Migrations

`packages/persistence/drizzle.config.ts` reads the schema from `packages/persistence/src/db/schema/` and the jobs package's two table files, and writes `packages/persistence/drizzle/<timestamp>_<name>/`. Generate with `vp run --filter @repo/persistence db:generate`; the config insists on a `DATABASE_URL` but generating never connects. The api, web and builder apply migrations on start (`packages/persistence/src/db/migrate.ts`); their images find them through `DRIZZLE_MIGRATIONS_FOLDER`. The worker image carries none.
