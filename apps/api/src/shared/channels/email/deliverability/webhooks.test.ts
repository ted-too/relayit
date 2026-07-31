import { describe, it } from "vitest";

/**
 * Seam: Email Deliverability outcomes from inbound provider webhooks (e.g. SES/SNS).
 * Product language: shared/channels/email/CONTEXT.md + Messages Delivery Event / Contacts Suppression.
 * Lives under shared (domain behavior); HTTP mount: POST /webhooks/providers/:vendorId/:productId.
 * Fake the vendor payload / signature at the adapter; assert Deliverability + Message/Contact effects.
 */
describe("hard bounce", () => {
  it.todo(
    "records a bounced Delivery Event and creates/updates Suppression at severity all"
  );
});

describe("complaint", () => {
  it.todo(
    "records a complained Delivery Event and creates/updates Suppression at severity marketing"
  );
});

describe("soft bounce / delivery_delayed", () => {
  it.todo(
    "may enqueue a retry Delivery under the same Message (up to the attempt cap) without creating Suppression"
  );

  it.todo(
    "after the attempt cap is exhausted, the latest Delivery is marked failed"
  );
});

describe("may send?", () => {
  it.todo(
    "exposes a channel-agnostic may-send / outcome summary to Messages (Provider circuit distinct from Domain pause)"
  );
});

describe("Webhook Events from delivery outcomes", () => {
  it.todo(
    "emits channel-agnostic Webhook Events (e.g. delivery.bounced) for matching Webhook Endpoints"
  );
});
