# SES tenant per Project on managed Providers

All Projects on a managed SES Provider share one SES account, and SES computes bounce/complaint rates per account. One Project mailing a stale list could get the whole account reviewed or paused, stopping every Project's mail.

Managed SES sends now go through an **SES tenant per Project** (`relayit-<projectId>`). The worker ensures the tenant on first send per process (create tenant, associate the Domain or Sandbox Domain identity and the shared `relayit-delivery-events` configuration set), then passes `TenantName` on `SendEmail`. SES's default **Standard** reputation policy pauses only that tenant on high-severity findings. Identity delete first removes tenant associations (SES refuses to delete an associated identity). The tenant name is derived, not stored — no schema change.

Ensuring the tenant **fails open**: if it fails (e.g. IAM lacks `ses:*Tenant*`), the send goes out untenanted as before and the ensure is retried next send. A `SendingPausedException` is classified as a Project Sending Pause only when `GetTenant` reports the tenant `DISABLED`; otherwise it stays an account-level `sending_paused`.

BYO Providers are excluded: they are the customer's own SES account, so tenants would add cost there without isolating anyone.

Rejected:
- **Configuration set per Project** — per-Project metrics only; no vendor-side enforcement, so we'd still build our own bounce-rate breaker.
- **Relayit-side bounce-rate breaker only** — reimplements what SES reputation policies already do, and doesn't change how SES attributes reputation.

Deferred: syncing SES tenant status back (EventBridge `Sending Status Enabled/Disabled`) so a pause shows on the Domain before the next send attempt, and so unpausing in SES unpauses the Domain.
