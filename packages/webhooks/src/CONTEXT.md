# Webhooks

Outbound Webhooks notify a Project's external systems about Relayit domain
events. Provider notification ingress is a separate Channels concern.

## Language

- **Webhook Event** — immutable Project event with a public type, payload,
  creation time, and stable idempotency ID.
- **Webhook Endpoint** — Project-owned URL with an Event allowlist, optional
  Message Tag filter, enabled state, and signing secrets.
- **Webhook Event Delivery** — one Event routed to one matching Endpoint.
- **Dead-lettered Delivery** — a Delivery that exhausted automatic retries and
  may be manually replayed.
- **Replay** — a new delivery run for the same Event Delivery. Total attempt
  history remains cumulative.

## Invariants

- Event emission and Delivery Job staging commit in the same database
  transaction through the Jobs outbox.
- No Event is persisted when no enabled Endpoint matches.
- Paused Endpoints do not match Events and accumulate no Deliveries. Pausing
  does not cancel Deliveries accepted before the pause.
- Delivery is at-least-once. Consumers deduplicate with `webhook-id`; ordering
  is not guaranteed.
- Delivery claims are leased so crashed workers do not permanently strand
  work.
- Secrets are returned only when created or rotated. Rotation keeps the
  previous secret for a bounded verification window.
- Only dead-lettered Deliveries may be manually replayed, and only while their
  Endpoint is enabled.
