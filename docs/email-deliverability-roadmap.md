# Email Deliverability Roadmap

Context dump of the remaining deliverability work for custom + sandbox sending
domains. Captures what is already done, the open issues, and candidate
solutions so this can be picked up later.

## Already done

- **Custom MAIL FROM domain** (`send.<domain>`) with MX + SPF, giving SPF
  alignment for DMARC. Implemented for both custom domains (customer-published)
  and sandbox domains (auto-published to our Cloudflare zone).
- **DKIM 2048-bit**, delegated via CNAME to our branded proxy
  (`<selector>._domainkey.<root>`) so we hold the key and can rotate it. BYODKIM
  key is portable across SES accounts.
- **DKIM record type fix**: cloud custom-domain DKIM is now a `CNAME` (was
  incorrectly a `TXT` carrying a hostname).
- **Root SPF removed**: we no longer publish SPF at the customer apex. All SPF
  lives on the `send.<domain>` MAIL FROM subdomain, so we never collide with the
  customer's existing apex SPF (Workspace / M365) and never risk an SPF
  permerror on their other mail.
- **Provider-agnostic MAIL FROM SPF**: in cloud the MAIL FROM SPF is
  `"v=spf1 include:_spf.relayit.fyi ~all"` (our managed include) rather than a
  hardcoded vendor include. Swapping/adding a sending vendor is a one-line change
  on `_spf.relayit.fyi` with zero customer DNS action.
- **TXT quoting**: all TXT record content is wrapped in quotes via
  `formatTxtRecordContent` (Cloudflare requirement).
- **Tri-state DNS record status** (`pending` / `active` / `missing`) that
  distinguishes never-seen from regressed.
- **Idempotent SES create/delete** (adopt `AlreadyExistsException`, ignore
  `NotFoundException`) so re-adding a domain can't be blocked by an orphaned
  identity.
- **Bounce & complaint handling + suppression** (issue 2): provider-registered
  webhooks at `POST /webhooks/:vendorId/:productId`, SES configuration set +
  SNS auto-provisioning, `emailDeliveryEvent` ingest, suppression on `contact`
  (`suppressionReason` / `suppressedAt`), send-time recipient filtering.
- **Managed DMARC reporting** (issue 3): cloud DMARC `rua` to
  `<customDomainId>@dmarc.relayit.fyi`, external-destination authorization TXT
  in our zone, SES inbound receiving → SNS webhook, aggregate XML parsed into
  `dmarcReport` / `dmarcReportRow`, raw reports archived via object-storage (R2).
- **One-click List-Unsubscribe (RFC 8058)** (issue 1): `List-Unsubscribe`
  with both `mailto:` (cloud) and `https://` URLs plus
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on single-recipient raw
  sends. HMAC-signed per-contact tokens; one-click POST at
  `/organization/bySlug/:orgSlug/contact/:contactId/email/unsubscribe`;
  cloud `mailto:` inbound at `<contactId>.<sig>@unsubscribe.<root>` via SES
  receipt rule → SNS → webhook; opt-outs set `contact.unsubscribed` and are
  filtered at send time. Multi-recipient sends do not yet get List-Unsubscribe
  (one SES `SendEmail` call cannot carry per-recipient tokens).

## Open issues

### 2. Bounce/complaint dashboard metrics — FOLLOW-UP

**Why:** Issue 2 ingest is live; operators still need UI for bounce/complaint
rates over a trailing window.

**What's needed:** Surface `emailDeliveryEvent` + suppressed `contact` counts
per domain/org in the dashboard.

### 3. DMARC dashboard + enforcement guidance — FOLLOW-UP

**Why:** Issue 3 ingest is live; customers need alignment health and a guided
path from `p=none` toward enforcement.

**What's needed:** Surface `dmarcReport*` alignment aggregates; recommend
`p=quarantine` / `p=reject` when data supports it.

### 4. NS-delegated MAIL FROM subdomain (full provider-switch transparency) — MEDIUM

**Why:** The MAIL FROM **MX** (`feedback-smtp.<region>.amazonses.com`) is the one
record still bound to vendor + region. An MX target can't be a CNAME, so we
can't proxy it the way we proxy SPF/DKIM. Same-vendor account moves are already
zero-touch (SPF indirected, DKIM key portable); only a region change or a
cross-vendor move would require the customer to update the MX.

**Best-practice solution — delegate a dedicated bounce subdomain:**
- Customer adds NS records once, delegating e.g. `send.zenra.app` to Relayit's
  authoritative nameservers.
- After that we own every record under `send.zenra.app` (MX, SPF, DKIM) and can
  repoint any vendor/region with zero further customer action.
- Alignment still holds: `send.zenra.app` is a subdomain of the From domain.

**Cost:** heavier one-time setup for the user (NS records) and we must run
authoritative DNS for the delegated subdomain (e.g. a dedicated Cloudflare zone
or Route 53 hosted zone per delegated subdomain, or a wildcard/managed setup).

**Alternative (lighter):** standardize on a single SES region so the MX never
changes in practice, and accept that a cross-vendor move is a rare,
manual-migration event.

## Suggested priority order

1. Bounce/complaint + DMARC dashboard surfaces (issues 2–3 follow-ups).
2. NS-delegated MAIL FROM (issue 4) — full provider-switch transparency.

## Notes / constraints

- DNS auth (SPF/DKIM/DMARC + custom MAIL FROM) is necessary but NOT sufficient
  for inbox placement. Engagement, content, volume warmup, and low complaint
  rates dominate once auth is correct.
- We cannot unilaterally set a strict DMARC policy on a customer's apex because
  it affects all their mail, not just Relayit's.
- Changes to record generation only affect newly created / re-added domains;
  existing rows are not retroactively migrated.
