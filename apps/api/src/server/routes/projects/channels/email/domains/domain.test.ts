import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/channels/email/domains).
 * Product language: shared/channels/email/CONTEXT.md (Sending Identity — Domain).
 * Channel-scoped so SMS (etc.) can mount under /channels/sms/… later.
 */
describe("POST /projects/:orgSlug/channels/email/domains", () => {
  it.todo(
    "adds a Domain for one FQDN to the Project; same FQDN cannot be an active Domain for two Projects"
  );

  it.todo(
    "send-ready for a pairing is DKIM + MAIL FROM only (no ownership TXT on normal add; ownership TXT is claim/transfer only)"
  );

  it.todo(
    "omit providerId uses current ops default managed backend; explicit pick may choose another managed backend or BYO"
  );

  it.todo(
    "held FQDN enters claim (source keeps send; at most one pending claim; ownership TXT until verified)"
  );

  it.todo(
    "claim success keeps DNS when destination chose same managed backend; otherwise teardowns and requires new DNS"
  );
});

describe("Domain verification and active Provider", () => {
  it.todo(
    "first successful Provider verification becomes the Domain’s active Provider"
  );

  it.todo(
    "explicit active-Provider switch applies to already-queued Deliveries at send time"
  );
});

describe("pause Domain", () => {
  it.todo(
    "while paused, new send requests that would use the Domain as From are rejected up front"
  );

  it.todo(
    "queued/scheduled Deliveries that would use a paused Domain fail at send time (not skipped, not held)"
  );
});

describe("DELETE /projects/:orgSlug/channels/email/domains/:id (remove)", () => {
  it.todo(
    "remove detaches the Domain; FQDN becomes available; queued Deliveries fail at send time; historical From retained"
  );
});
