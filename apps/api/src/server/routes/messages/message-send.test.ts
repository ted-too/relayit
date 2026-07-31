import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → multi-channel Message API).
 * Product language: shared/messages/CONTEXT.md — transactional Message with channels in the request
 * (distinct from `/messages/email`, the Resend-compatible email-only facade).
 * Lives under server/routes (HTTP mount); domain policy stays in shared/messages.
 *
 * Stubs only — un-todo one vertical slice at a time when rewiring.
 * Fake vendor adapters at system boundaries; do not mock Channels modules.
 *
 * When live:
 *   import { treaty } from "@elysiajs/eden";
 *   import { app } from "@repo/api/server";
 *   const api = treaty(app);
 *   const { data, error } = await api.messages.post({ ... }, { headers: { ... } });
 */
describe("POST /messages (multi-channel transactional send)", () => {
  it.todo(
    "accepts channels in the request and creates a Message with Purpose=transactional and one Delivery per channel"
  );

  it.todo(
    "stores each channel’s Channel Format on its Delivery (inline or rendered from a Template at create)"
  );

  it.todo(
    "requires an explicit From / sending identity on identity-bearing channels — no implicit Sandbox Domain or Project default"
  );

  it.todo(
    "with the same Idempotency Key, returns the original Message; a different body with that key still returns the original"
  );

  it.todo("with scheduled_at, accepts the Message in queued status until due");

  it.todo(
    "rejects the whole request up front when any channel’s Delivery would exceed the Billing User Usage bucket"
  );

  it.todo(
    "exposes Message status as a coarse rollup over Deliveries, including partial when outcomes mix"
  );

  it.todo(
    "includes Attachments on email Deliveries; channels that do not support attachments ignore or reject per channel rules"
  );
});

describe("POST /messages/batch (multi-channel transactional batch)", () => {
  it.todo(
    "accepts a batch of multi-channel sends and creates one Message (Purpose=transactional) per item"
  );

  it.todo(
    "rejects the whole batch up front when the combined sends would exceed the Billing User Usage bucket"
  );

  it.todo(
    "applies Idempotency Key per item the same way as a single POST /messages"
  );
});

describe("GET /messages", () => {
  it.todo(
    "lists Messages for the Project with coarse Message status suitable for list UIs"
  );

  it.todo(
    "filters by Message status, Purpose, App / App Environment, and/or Message Tags"
  );

  it.todo("does not return Messages from other Projects");
});

describe("GET /messages/:id", () => {
  it.todo(
    "returns the Message by id with coarse Message status and its Deliveries"
  );

  it.todo("rejects when the Message is not in the caller’s Project");
});

describe("cancel scheduled Message", () => {
  it.todo(
    "cancels a queued scheduled Message before Provider accept — Deliveries become canceled"
  );

  it.todo(
    "rejects cancel after a Delivery has been sent (later outcomes are Delivery Events only)"
  );
});

describe("update scheduled Message time", () => {
  it.todo(
    "updates scheduled_at on a queued scheduled Message that has not been handed to a Provider"
  );

  it.todo(
    "rejects updating scheduled_at once the Message is no longer only queued / cancelable"
  );
});
