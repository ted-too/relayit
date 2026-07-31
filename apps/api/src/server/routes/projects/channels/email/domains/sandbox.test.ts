import { describe, it } from "vitest";

/**
 * Seam: email Sandbox Domain under /projects/:orgSlug/channels/email
 * (provisioned via POST /projects).
 * Product language: shared/channels/email/CONTEXT.md.
 */
describe("Sandbox Domain", () => {
  it.todo("at most one Sandbox Domain per Project");

  it.todo(
    "provisioned when the Project is created under a Relayit-owned DNS root"
  );

  it.todo(
    "always sends via the Project’s managed email Provider (no active-Provider switch)"
  );

  it.todo(
    "remains available for restricted/test sends after the Project has verified Domains"
  );
});
