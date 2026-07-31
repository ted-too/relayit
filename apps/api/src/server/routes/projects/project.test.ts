import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects).
 * Product language: shared/tenancy/CONTEXT.md + Channels/Email provisioning.
 */
describe("POST /projects", () => {
  it.todo(
    "creates a Project and provisions its email Sandbox Domain and managed email Provider"
  );

  it.todo("defaults Billing User to the Project Owner");
});

describe("DELETE /projects/:id", () => {
  it.todo(
    "Owner delete removes Project-scoped data and Domains (FQDNs freed); Sandbox Domain ends with the Project"
  );

  it.todo(
    "Usage already consumed in the current Billing Period stays on the Billing User (no clawback)"
  );
});
