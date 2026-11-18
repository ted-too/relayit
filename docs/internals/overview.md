# Overview

How Relayit is put together, and why. [AGENTS.md](../../AGENTS.md) has the glossary and the rules; this page has the decisions behind the shape of the code.

## Shape

```
customer's code ── x-api-key ──► apps/api (HttpApi) ── POST /messages/email, /send/*
                                   │  accept: Message + Delivery + job, one transaction
                                   ▼
                             Postgres outbox ──(relayed by the worker)──► Redis Streams
                                                                              │
                                   apps/worker (no HTTP): every job handler ◄─┘
                                        ├─► SES (packages/provider-aws) ─► recipient
                                        └─► customer's Webhook Endpoints
SES ── SNS ──► apps/api /webhooks/providers/aws/ses ─► bounces, complaints, Suppression

browser ──► apps/web (APP_URL): static build + /config.js (API_URL, read at start)
   │
   └── fetch, credentials, CORS ──► apps/api (API_URL)
                                     ├── /auth/*: better-auth
                                     ├── /config, /projects/…: DashboardApi ─► Postgres, Redis, SES
                                     │      └── Effect Rpc + shared secret ──► apps/template-builder ─► S3
                                     └── /unsubscribe/…: one-click POST (also from mailbox providers)

apps/site: marketing site and public docs
```

The api, worker and builder share one Postgres and one Redis. The domain lives in `packages/*`, which the apps import through explicit subpaths; an app never imports another app's source.

## Decisions

### Four deployables, one database

Template building installs npm packages and runs builds, so it has its own process and lifecycle (`apps/template-builder`) that only the api calls. Public ingress (`apps/api`) and background work (`apps/worker`) are separate deployables too. They began as one process, and that was a mistake: request capacity and worker capacity scaled together and shared a failure domain, so a crash, or a burst of delivery work, hit the API too. Now each scales and fails alone; the price is a service to deploy, and a deployment without the worker accepts sends that queue and never go out. The dashboard (`apps/web`) is the fourth: static files, with no database or credentials.

The api runs one process per replica and scales with replicas, not by forking: its `node:cluster` mode existed to keep the worker on one primary, never ran in production (it needed `NODE_ENV=production`, which the images don't set), and went with the worker. Several workers are safe: they share one Redis consumer group, and a dead one's claims are reclaimed after a minute.

The api, worker and builder share one database and one migration history, in `packages/persistence/drizzle/`, aggregated from the persistence schema and the jobs package's tables. The api and builder each apply pending migrations on start under a Postgres advisory lock, so whichever starts first migrates and the others wait, then find nothing to do. The worker never migrates: it assumes a current schema, so a deploy that adds a migration rolls out the api before the worker.

### The dashboard is a client of the api

Everything a signed-in user does runs in the api, and the dashboard only calls it. The api is one host (`API_URL`, api.relayit.io) whose paths start at the root, and the dashboard is another (`APP_URL`, app.relayit.io). better-auth is mounted at `/auth/*` (sign-in, sessions, organizations and members, the GitHub callback `/auth/callback/github`, Stripe's webhook `/auth/stripe/webhook`); the rest (creating a Project, API keys, Domains, Templates, Email Workspaces) is `DashboardApi`, an `HttpApi` contract in `packages/contracts` that the api serves at the root beside the public API (`GET /config`, `POST /projects`, and each Project's resources under `/projects/:orgSlug/…`) and the dashboard calls with the client derived from it. It is a separate `HttpApi` from the public one, so none of it reaches `/docs`: it is the dashboard's, with no stability promise, and the contract package depends on `effect` alone, so nothing server-side follows it into the browser.

One namespace, two kinds of route, told apart by the contract a route is in rather than by its path. An endpoint of `Api` takes an API key in `x-api-key` and sends no CORS headers; a session cookie there is ignored, so a request without a key is refused as the contract tests pin (422 naming the missing header, 403 for an unknown key). An endpoint of `DashboardApi` takes the session cookie and nothing else: an API key there is refused with 401 even beside a cookie, and its routes, with better-auth's and unsubscribe's, are given the CORS middleware where they are built, so a new endpoint can't be served without it (`apps/api/src/auth-rule.test.ts` checks every endpoint of both contracts). If the public API ever serves Projects to API keys, it is the same resource with a second auth scheme, not a second path.

`HttpApi` rather than Effect Rpc because these are plain requests and responses authenticated by the session cookie: each operation gets a readable URL and status, the session middleware is the same shape as the API key one, and errors are typed per endpoint. Rpc stays where it is: between the api and the builder, one service calling another with a shared secret.

Authorisation is in two middlewares, never in a handler. `DashboardSession` resolves the cookie to a user (401 without one). `ProjectAccess` also resolves `:orgSlug` to the user's membership of that Project and checks the role's permission named by the endpoint's `RequiresPermission` annotation against the roles in `packages/persistence/src/auth/permissions.ts`; an unknown Project, a non-member and a missing permission are all 403, so a Project's existence isn't revealed. A handler sees only `DashboardMember`, and every query it makes is scoped to that Project's id, so an id taken from another Project finds nothing (404). A change must name the dashboard's origin (`APP_URL`) in `Origin`, as better-auth requires on its own routes: these handlers call `auth.api` directly, which skips better-auth's check, so the middleware makes it. The session cookie is `SameSite=Lax`, which already keeps it off another site's POST.

The dashboard is a Vite + TanStack Router single-page app on its own origin, calling the api cross-origin. It was a TanStack Start app with server-side rendering; behind sign-in, rendering on the server bought nothing and needed a server of its own with every credential. It stays a separate deployable rather than files the api serves: the api is the API's host and nothing else, and the dashboard can be deployed, cached and rolled back on its own.

Cross-origin, done once: the api grants CORS to `APP_URL` exactly, with credentials, on better-auth's routes, every `DashboardApi` route and unsubscribe, answers their preflights, and grants no other origin. The public API sends no CORS headers (it is called by servers holding a key, never from a page), so its preflight stays the 404 the contract tests pin. better-auth's base URL is `API_URL` and it trusts `APP_URL`, so sign-in, its CSRF check and every redirect after sign-in (GitHub's included, which returns to the api and is sent on to the dashboard) accept that origin alone. A failure better-auth can't send back to the page that started the sign-in (an OAuth callback whose state is gone) goes to the dashboard's sign-in page, not better-auth's error page on the api. The session cookie is the api's, `HttpOnly` and `SameSite=Lax`: Lax is sent on the dashboard's fetches because `app.` and `api.` of one domain are the same site, as are two ports of localhost in development. Two hostnames that are not one site (two unrelated domains, or two subdomains of a public suffix such as `up.railway.app`) are not supported: the cookie would need `SameSite=None`, which browsers increasingly block as a third-party cookie. `AUTH_COOKIE_DOMAIN` widens the cookie to the parent domain only so the marketing site can see a visitor is signed in; the dashboard doesn't need it.

No deployment's URL is in the build, because self-hosters run the published image. The image is nginx and the build, with no JavaScript runtime (`apps/web/nginx`): its entrypoint checks `API_URL` as the container starts and writes its origin into `/config.js`, which `index.html` loads before the app. The rest is the build, compressed once at image build: a file that exists as it is (`assets/` cached for good, everything else revalidated), and `index.html` for any other path (a path may have a dot in it, `/acme/domains/mail.example.com`, so the extension decides nothing). A missing file under `assets/` is a 404, so a stale tab fails loudly instead of parsing the page as a script. In development Vite answers `/config.js` the same way, and the dashboard on `WEB_PORT` calls the api on `API_PORT` cross-origin, so CORS and cookie mistakes show up there rather than in production.

Unsubscribe links point at the api (`API_URL/unsubscribe/:orgSlug/:contactId?msg&topic&sig`). A mailbox provider's one-click POST is answered there without a cookie; a person who opens the link is redirected to the dashboard's page at the same path on `APP_URL`, which sends the same POST when they confirm. A GET never unsubscribes, because link scanners open every URL in a message.

A Project's slug names it in every URL (the dashboard's `/<slug>`, the api's `/projects/<slug>/…` and `/send/<slug>/…`), so it is held to one rule, `ProjectSlug` in the contract: lowercase letters, digits and single hyphens, 2 to 48 characters. better-auth's organization hooks in `createAuth` check it, so no create or rename escapes it, and a new Project's slug is derived from its name to pass it (`projectSlugFromName`). It is the first segment of the dashboard's URLs, so the dashboard's top-level pages and `assets/` (`RESERVED_PROJECT_SLUGS`) are refused too; its other root files (`config.js`, `favicon.ico`) have a dot, which no slug can. The api's paths don't matter here: it is another host.

### Work crosses processes as typed jobs

A job's contract (`defineJob`: name, payload schema, retry and dead-letter policy, recurrence) belongs to its domain package, next to its handler. The api imports contracts and enqueues; only `apps/worker` imports and registers handlers, so producing a job never decides where it runs. An HTTP handler never does delivery or infrastructure work itself.

A job that depends on rows being written is enqueued through the Postgres outbox in the same transaction, so a send is never accepted without its delivery job, nor a job left pointing at rows that rolled back. The outbox publishes to Redis Streams; a crashed worker's claims are reclaimed after a minute; a job that exhausts its retries is dead-lettered in Postgres.

### `/messages/email` is Resend-compatible

Transactional email is sent with `POST /messages/email`, shaped like Resend's send-email API so a Resend client can point at Relayit with minimal change. Relayit-only fields may be added, never required. It creates a transactional Message and one email Delivery; it is not a second concept and never sends marketing. Two incompatibilities are deliberate: `topic_id` is rejected, because Topic consent belongs to Campaign sends; and webhook event types are channel-agnostic (`message.sent`, `delivery.skipped`), not Resend's `email.*`. The categories match (delivery outcomes, Domain and Contact lifecycle); the names don't. The legacy `/send/*` stays for existing integrations.

The api is an Effect `HttpApi` (`apps/api/src/api.ts`), but its responses are the ones the Elysia server it replaced answered with: the same statuses, bodies, field order and content types (`application/json;charset=utf-8`), a bare `400 Bad Request` for a body that isn't JSON and `404 NOT_FOUND` for an unrouted path. A request's headers and body are checked against their schemas before its API key is, as Elysia did, by the `RequestValidation` middleware; the endpoint's own decoding then never fails. `apps/api/src/contract.test.ts` pins all of it; a change there is a change to a customer contract.

### Accept, then deliver

Accepting a send is synchronous and cheap: validate, drop recipients suppressed at severity `all` (the response lists them), reserve Usage, then write the Message, its Delivery, its Contacts and the delivery job in one transaction. If the accept then ends any way but success (a failure, a defect, the client disconnecting, even during COMMIT or with COMMIT's answer lost), Relayit reads back, once the transaction is over, whether the Message was written; only if it was not are the Usage reservation released and the staged attachments removed. If that read fails as well, both are kept: a reservation may leak, but a committed send never loses its attachments. An `Idempotency-Key` header makes a retried request within 24 hours return the original Message rather than send twice.

The worker checks suppression again before sending, since a bounce may have landed in between. A Delivery whose recipients are all suppressed ends `skipped`; one that cannot be sent ends `failed` with its reason. Each outcome emits its webhook event in the transaction that records it.

Jobs run at least once, and a reclaim can run one job twice at the same time, while SES takes no idempotency key; so the Delivery's status is what keeps a send from going out twice. A run sends only after claiming the Delivery from `queued` to `sending`, which stamps `startedAt`. The SDK never retries SendEmail (its client has `maxAttempts: 1`); only the delivery job decides what follows a send. SES's answer to a claim goes to Redis (keyed by the Delivery and the claim) the moment it arrives, then to Postgres; the claim, the send (bounded by a 30-second timeout) and those writes run uninterruptibly, so a worker shutting down finishes them. Only an error that proves SES never took the send puts the Delivery back to `queued` for a retry: a rejection, a throttle, a validation, authentication or configuration error or any other 4xx SES answered with, or a DNS, connect or TLS failure before the request went out. A timeout, a connection dropped after the request was written, a 5xx or an unreadable answer leaves it `sending`, since SES may have taken it. A run that finds the Delivery `sending` never sends it: with an accepted answer in Redis it records `sent`; with a refusal it requeues it; with no answer it retries while the claim is within its two-minute lease, since its owner may still be sending, and fails it once the lease has run out. A run that only lost the claim to another never fails the Delivery; the winner has retries of its own. An outcome that can't be written yet (Postgres down) fails the job's dead-letter step, which leaves the job pending, and the reclaim loop runs it again until the outcome is written. Usage confirmation after SES has accepted is bookkeeping: its failures retry or are logged, never fail the Delivery.

What that guarantees: an accepted Message is sent at most once, except while workers from before this design and after it run side by side (the old handler re-sends a `sending` Delivery). A client that loses the response to an accept, even mid-COMMIT, may find the send accepted; retrying it without an `Idempotency-Key` makes a second Message. A Delivery can end `failed` though SES delivered it when SES took the send but its answer never reached Relayit (the timeout, a dropped connection or a 5xx after acceptance), when the worker died between SES's answer and the Redis write, or when that answer could be written to neither Redis nor Postgres before the claim's lease ran out.

### SES tenant per Project

All Projects on the platform's SES account share that account's bounce and complaint rates, so one Project mailing a stale list could get the account paused and stop everyone's mail. Sends therefore go through an SES tenant per Project (`relayit-<projectId>`, derived, not stored), with SES's Standard reputation policy pausing only that tenant. The worker ensures the tenant on a Project's first send from a region in each process: it creates the tenant there and associates the Domain identity and the shared configuration set. A Domain identity is detached from its tenants before it is deleted, since SES refuses to delete an associated one.

Ensuring the tenant fails open: if it fails (IAM lacking `ses:*Tenant*`, say), the send goes out untenanted and the next send tries again. A `SendingPausedException` is a Project Sending Pause only when `GetTenant` reports the tenant `DISABLED`; otherwise it is the whole account paused. Unpausing a tenant in SES does not yet unpause the Domain.

Per-Project configuration sets were rejected because they give metrics but no enforcement; a Relayit-side bounce-rate breaker because it rebuilds what SES's reputation policies already do, without changing how SES attributes reputation.

### Setup assistance, not a provider proxy

Relayit helps a Project finish the setup a vendor needs before it can send, and stops there; it does not proxy the vendor's control plane, which was too much work for what customers need. For email that means Relayit generates the Domain's DKIM key (BYODKIM), registers it with SES, and lists the DNS records the customer publishes, then polls until they verify. The Sandbox Domain's records are on Relayit's own Cloudflare zone, so Relayit publishes them itself.

### One SES account, configured by ops

A deployment sends through one SES account, named in the environment of the api and the worker (`SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGIONS`); the database holds no vendor credentials and customers bring none. Code sends and registers through the `EmailBackend` service (`packages/channels/src/email/backend.ts`), implemented for SES and for the fake in `packages/provider-aws`. Pluggable providers, Project-owned credentials and Domains paired with several providers were removed: each multiplied the paths a send could take for customers who never asked for them.

The account can span several regions, so a later channel can route by destination without the customer choosing; email uses that only to place Domains. A Domain is registered in one region, the first of `SES_REGIONS` when it is added, recorded on its registration (`email_domain_provider_identity`, a name kept so its rows did not have to move), and always sent through that region: there is no failover between regions. A registration with no recorded region predates regions and is in the default one, so the first entry of `SES_REGIONS` must stay the region those Domains were registered in. A send SES refuses for any reason but a Project Sending Pause is retried with backoff; when the retries run out the Delivery fails with that reason.

A Domain goes with its last link, holder's or claimant's, except that one Deliveries still name is kept as a bare row. A Delivery names the Domain it was sent from under a foreign key that refuses the delete (#70), so such a Domain loses its registration, DNS rows and SES identity and keeps its row, unlinked and unverified, with the DKIM key its DNS publishes. Adding it again is therefore a claim. Nothing removes it at the moment its Deliveries go: it goes afterwards with the next link it loses (a later claim on it removed or lapsed, or a Project linked to it deleted), or else at the sweep described below. Otherwise the transaction that removes the last link removes the registration, DNS rows and row with it, holding the Domain's row so a claim arriving at that moment either lands first and keeps the Domain or finds the row gone and adds the FQDN as new. The SES identity is deleted by a job enqueued in that transaction (`email.delete-domain-identity`), whose payload names the FQDN and region because the row may be gone when it runs. SES names an identity by FQDN alone, so that job and a registration of the same FQDN take one advisory lock; the job leaves the identity alone when the FQDN is registered again, and a registration creates nothing unless the Domain still has a link. The lock orders the two only while each SES call answers. A call is given up after 30 seconds so that one which never answers can't pin a connection and the locks, and giving it up releases them while the request may still reach SES late. In those rare orderings a late delete can take the identity of a Domain registered since, leaving a registered Domain without one, and a late create can leave an identity whose Domain has no registration or no row; nothing detects either. A Project's deletion is better-auth's and takes the links by cascade, where no code sees the last one go: the api reads them in `beforeDeleteOrganization` and removes the Domains left without one in `afterDeleteOrganization`, and the worker sweeps every Domain as it starts, removing those without a link and passing over rows that are already bare and still named by Deliveries.

At startup the worker creates, in every region, the configuration set each send names and an SNS topic subscribed to the api's SES notification URL. The resources are named after that URL, so a restart with the same URL finds them and changes nothing; that is also why the URL keeps its old `/webhooks/providers/aws/ses` shape.

SNS signs every topic's messages alike, so a valid signature proves only that the message came through SNS, not from this deployment: anyone can subscribe the api to a topic in their own account and publish a bounce. The api therefore reads a message, or confirms a subscription, only from the topics the worker makes: it derives their names from its own `API_URL` and their account from STS with the `SES_*` credentials. The api and worker must share `API_URL`, `SES_*` and `SES_REGIONS`, or the api rejects every notification. Removing a region from `SES_REGIONS` stops the api trusting that region's topic, so late bounces and complaints for mail already sent through it are refused; keep a region listed until its mail has aged out. Each notification's SNS `MessageId` becomes its Delivery Event's id, so a redelivery records nothing twice.

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

The fake and local storage run only when `NODE_ENV` is `development` or `test`, whether asked for or left to default. The api, worker and builder images set no `NODE_ENV`, so an unset one has to mean SES and S3, and an explicit `EMAIL_BACKEND=fake` in a deployment must refuse to start: the fake marks every Delivery sent while delivering nothing, and its DNS answers would let a Domain claim pass without proof.

### React's `use-sync-external-store` shim in SSR

Nitro's bundled server can keep a runtime `require("react")` inside CommonJS it inlines from `use-sync-external-store/shim` (via `@base-ui/utils`), which loads a second React or none. `apps/site` resolves the shim to ESM that imports the bundled React (`vite/resolve-use-sync-external-store-from-react.ts`), and its image sets `NODE_ENV=production`. Delete the plugin once our Nitro version ships `experimental.cjsRequireRewrite`.

## Migrations

`packages/persistence/drizzle.config.ts` reads the schema from `packages/persistence/src/db/schema/` and the jobs package's two table files, and writes `packages/persistence/drizzle/<timestamp>_<name>/`. Generate with `vp run --filter @repo/persistence db:generate`; the config insists on a `DATABASE_URL` but generating never connects. The api and builder apply migrations on start (`packages/persistence/src/db/migrate.ts`); their images find them through `DRIZZLE_MIGRATIONS_FOLDER`. The worker image carries none.
