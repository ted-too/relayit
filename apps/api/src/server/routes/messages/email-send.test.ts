import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → POST /messages/email).
 * Product language: shared/messages/CONTEXT.md + ADR-0001.
 * Lives under server/routes (HTTP mount); domain policy stays in shared/messages.
 *
 * Stubs only — un-todo one vertical slice at a time when rewiring.
 * Fake SES (and other vendors) at the Provider adapter; do not mock Channels/Email modules.
 *
 * When live:
 *   import { treaty } from "@elysiajs/eden";
 *   import { app } from "@repo/api/server";
 *   const api = treaty(app);
 *   const { data, error } = await api.messages.email.post({ ... }, { headers: { ... } });
 */
describe("POST /messages/email (transactional send)", () => {
  it.todo(
    "accepts a Resend-shaped body and creates a Message with Purpose=transactional and an email Delivery"
  );

  it.todo(
    "requires an explicit From — rejects when From is missing (no implicit Sandbox Domain or Project default)"
  );

  it.todo(
    "rejects when From does not resolve to a usable Domain or Sandbox Domain for the Project"
  );

  it.todo(
    "rejects up front when From would use a paused Domain (no Message accepted)"
  );

  it.todo(
    "rejects topic_id — Topic consent is marketing-path only (Campaign Send), not this facade"
  );

  it.todo(
    "with the same Idempotency Key, returns the original Message; a different body with that key still returns the original"
  );

  it.todo("with scheduled_at, accepts the Message in queued status until due");

  it.todo(
    "rejects the whole request up front when the send would exceed the Billing User Usage bucket"
  );

  it.todo(
    "makes the created Message retrievable with the expected coarse Message status"
  );
});

describe("POST /messages/email/batch (transactional email batch)", () => {
  it.todo(
    "accepts a batch of Resend-shaped bodies and creates one Message (Purpose=transactional) with an email Delivery per item"
  );

  it.todo(
    "rejects the whole batch up front when the combined sends would exceed the Billing User Usage bucket"
  );

  it.todo(
    "applies Idempotency Key per item the same way as a single POST /messages/email"
  );

  it.todo(
    "requires an explicit From on each item — no implicit Sandbox Domain or Project default"
  );
});
