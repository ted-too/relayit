# Context Map

Relayit is a multi-tenant messaging platform: tenants send messages through Relayit; email is the first channel.

## Contexts

- [Tenancy](./apps/api/src/shared/tenancy/CONTEXT.md) — users, plans, projects (create provisions managed email Provider + Sandbox Domain; delete frees Domains), apps, app environments, API keys
- [Messages](./apps/api/src/shared/messages/CONTEXT.md) — the act of sending, send lifecycle, usage tracking; Campaigns (id + non-unique name + Topic + Template; per-channel send-ready Froms; archive soft-deletes) for marketing fan-out; Project-scoped Templates (id + non-unique name, per-channel variants; email primitive inline or link to Email Workspace Entry); Webhook Endpoints (enable/disable, at-least-once with idempotency id, no ordering) for outbound events; explicit From required on identity-bearing channels (Campaign carries per-channel Froms)
- [Contacts](./apps/api/src/shared/contacts/CONTEXT.md) — recipients at furthest scope (one Contact per primary address in scope; delete retains Suppression/Unsubscribe on the address); Contact Tags; Segments for targeting (id + non-unique name; archive soft-deletes); Topics for consent (id + non-unique name; archive soft-deletes); Suppression (per address, severity marketing|all; manual add/remove + bounce/complaint)
- [Channels](./apps/api/src/shared/channels/CONTEXT.md) — how a project sends (email, SMS, WhatsApp, …); channel-specific formats

### Under Channels

- [Email](./apps/api/src/shared/channels/email/CONTEXT.md) — first concrete channel. Modules: **Providers** (managed attached at Project create), **Deliverability**, **Sending Identity** (product entities: **Domain** — Project-scoped, one FQDN, Resend-style DNS per Provider pairing, active + optional failover-eligible Providers, may be paused; **Sandbox Domain** — ≤1 per Project, provisioned at Project create, Relayit-owned root, kept after Domains verify)
- [SMS](./apps/api/src/shared/channels/sms/CONTEXT.md) — planned stub; full language deferred. Provider AWS End User Messaging. Sending Identity entities will be concrete (phone number, sender ID, …)

## Relationships

- **Tenancy → Messages / Contacts / Channels**: Project is the primary tenant boundary. App / App Environment are optional attribution scopes (deleting them removes Contacts in that furthest scope; Project-scoped entities remain). Campaign, Topic, and Segment are Project-scoped; Contacts (and Message/Campaign Send attribution) use furthest scope when App/Env are set. Project creation provisions the Project’s email Sandbox Domain and attaches the managed email Provider. Project delete removes Project-scoped data and Domains (FQDNs freed); consumed Usage is not clawed back
- **Messages → Channels**: a Message may have many Deliveries (one per channel); each Delivery may carry its own Channel Format. Messages asks the channel whether it may send; it does not own bounce/complaint/reputation details
- **Messages → Contacts**: recipients of a send; marketing suppression/unsubscribe checked against the contact (Unsubscribe is per Topic or all marketing, never by leaving a Segment). Contacts live at furthest scope (one per primary address in that scope; primary-address change rejects on collision; delete retains Suppression/Unsubscribe on the address); Messages/Campaign Sends record App/Env for attribution and Contact resolution. Transactional Messages are created directly; marketing Messages only via Campaign Send. Every Campaign has a Topic and a Template (plus per-channel Froms); Campaign Sends may target a Segment and/or explicit Contacts
- **Messages → Webhook Endpoints**: Project-scoped endpoints (`/projects/:orgSlug/webhookEndpoints`) receive channel-agnostic Webhook Events for delivery outcomes, Message/Campaign Send status, Domain and Contact lifecycle (inbound receive out of scope). Events persist only when ≥1 Endpoint matches; disabled Endpoints hold matching deliveries for replay. Signing secret rotates with a dual-secret window; HTTP delivery is at-least-once with idempotency id and no ordering guarantee. Distinct from Provider notification ingress (`/webhooks/providers/…`)
- **Channels → Email**: Email is a channel context; Messages talks to Channels, not to SES directly. Sending Identity (Domain — one FQDN, one active Provider set by first verify / explicit switch, send-time Provider for queued work; Sandbox Domain — ≤1 per Project, managed Provider identities; Domain may be paused with hard reject / queued fail; claim/transfer in product scope — destination picks Provider, same managed backend keeps DNS else teardown), Providers, and API keys stay Project-scoped (BYO Project-owned; managed backends ops-wired)
- **Email.Deliverability → Messages**: Email owns channel delivery signals (bounces, complaints, domain reputation, provider circuit) and exposes a channel-agnostic “may send?” / outcome summary to Messages. A paused Domain rejects new sends that would use it; already-queued Deliveries fail at send time (not `skipped` / not held). Removing a Domain frees the FQDN and fails in-flight Deliveries the same way; historical From is retained on Messages
- **Tenancy.Plan ↔ Messages.Usage**: Cloud: Plan on User defines Purpose×Channel limits (and managed vs BYO pricing); Usage is per Delivery in the current **Billing Period**, consumed against the Project’s **Billing User** (must be a Project member; defaults to Owner; mid-cycle reassignment is instant for future sends, no Usage transfer; cannot leave while Billing User). Self-hosted: no Plans / Plan logic — entitlements behave as unlimited (full features). No separate Billing context yet — Stripe/invoices stay out of the glossary
- **Channels.Provider → Usage**: managed and customer-connected (BYO) Providers both meter Usage; BYO is substantially cheaper on the Plan. BYO Providers are Project-owned (like Domains). BYO add is edition-split: cloud Plan-gated (`byoProviders`); self-hosted always allowed (no Plans). Losing cloud entitlement freezes BYO sends as billing-limits-reached until Domains move off BYO (pairings kept). Platform wiring of managed vendors is ops-only (not a glossary noun). Email: Domain create may choose among available managed backends / BYO when more than one exists (omit → current ops **default** managed backend); ops cannot delete a managed backend while Domain/Sandbox pairings still reference it

See also:
- [ADR-0001](./docs/adr/0001-resend-compatible-transactional-facade.md) — `/messages/email` is Resend-compatible for transactional send; Resend `topic_id` is intentionally unsupported (1:1 marketing → Campaign Send). Webhook event *type names* are channel-agnostic (not a drop-in for Resend `email.*` webhooks); event *categories* align (delivery, domain, contact).
- [ADR-0002](./docs/adr/0002-byodkim-not-full-provider-proxy.md) — all channels: Provider setup assistance, not full proxy; sending-identity artifacts verified per Provider (email: BYODKIM / Domain).
- [ADR-0003](./docs/adr/0003-process-first-api-src-layout.md) — `apps/api/src` is process-first (`server` / `worker` / `shared`); domain contexts live under `shared/`.
- [ADR-0004](./docs/adr/0004-camelcase-http-path-segments-for-eden.md) — multi-word HTTP path segments are camelCase for Eden; Project channel resources nest under `/projects/:orgSlug/channels/{channel}/…`; Project BYO Providers at `/projects/:orgSlug/providers`; ops managed backends at `/admin/providers`.
- [ADR-0005](./docs/adr/0005-template-workspace-sealed-artifacts.md) — Templates are the send catalog; React Email (and future engines) use a static workspace-kind registry under `/templating/` (`reactEmail/<slug>.tsx` entries); Git objects in S3 + refs in Postgres per Email Workspace (+ optional GitHub source seam); explicit build → sealed artifacts; Message create sandboxes the artifact.
- [ADR-0006](./docs/adr/0006-project-owned-byo-providers.md) — BYO Providers are Project-owned (like Domains); managed backends stay ops-wired.
- [ADR-0007](./docs/adr/0007-sticky-managed-provider-baseline.md) — omit Provider on Domain create uses the current ops default managed backend (no per-Project sticky store).
- Route Zod schemas live under [`apps/api/src/shared/validators/`](./apps/api/src/shared/validators/) (`@repo/api/validators`).

## Deferred (not in glossary yet)

Intentional gaps until those product surfaces are designed — not open holes in the send/contact/email model:


- **Inbound receive** (customer inbound mailbox / receive-as-a-product — not Provider notification ingress under Email.Deliverability)
- **SMS** beyond the stub (concrete Sending Identity nouns, A2P consent specifics)
- **Billing** as its own context (Stripe, invoices, payment nouns) — Plan / Billing Period / Usage stay under Tenancy / Messages
- **GitHub Workspace Source** for Email Workspaces (link repo → build-on-push → sealed artifacts) — seam reserved; v1 is hosted IDE + Publish only
