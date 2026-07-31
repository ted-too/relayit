import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/webhookEndpoints).
 * Product language: shared/messages/CONTEXT.md (Webhook Endpoint / Webhook Event).
 * Path segments are camelCase for Eden Treaty (see ADR-0004).
 */
describe("POST /projects/:orgSlug/webhookEndpoints", () => {
  it.todo(
    "creates a Project-scoped Webhook Endpoint with signing secret and event-type allowlist"
  );

  it.todo("empty allowlist means no event types are delivered");
});

describe("enable / disable", () => {
  it.todo(
    "while disabled, matching Webhook Events are still recorded (held) for replay after re-enable"
  );
});

describe("signing secret rotation", () => {
  it.todo(
    "rotation keeps current and previous secrets during a dual-secret window; Relayit signs with current"
  );
});

describe("Webhook Event delivery", () => {
  it.todo(
    "delivers at-least-once with a stable idempotency id and no ordering guarantee"
  );

  it.todo(
    "type names are channel-agnostic (delivery.*, message.*, domain.*, contact.*) — not Resend email.* prefixes"
  );

  it.todo(
    "failed HTTP deliveries retry with backoff then enter dead-letter and can be manually replayed"
  );

  it.todo(
    "emission is a no-op (nothing persisted) when no Endpoint matches the event type / tag filter"
  );
});
