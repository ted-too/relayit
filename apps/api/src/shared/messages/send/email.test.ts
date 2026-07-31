import { describe, it } from "vitest";

/**
 * Seam: email send queue handler (`emailSendQueue` process) — worker path, not HTTP.
 * Product language: shared/messages/CONTEXT.md + email Deliverability.
 * Fake SES at the Provider adapter; use test DB for Message/Delivery state.
 */
describe("email send queue process", () => {
  it.todo(
    "hands a queued email Delivery to the Domain’s active Provider (Sandbox → managed Provider)"
  );

  it.todo(
    "when the Domain is paused at send time, fails the Delivery (not skipped, not held)"
  );

  it.todo(
    "soft bounce / delivery_delayed is Provider-owned — records Delivery Events on the same Delivery; does not create a new Relayit Delivery"
  );

  it.todo(
    "confirms Usage on Provider accept (Delivery → sent); skips/cancels before accept release the reserve"
  );

  it.todo(
    "records Delivery Events (accepted, delivered, …) without replacing Delivery status as source of truth"
  );
});
