import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/billingUser).
 * Product language: shared/tenancy/CONTEXT.md.
 */
describe("PUT /projects/:orgSlug/billingUser", () => {
  it.todo("must be a member of the Project");

  it.todo(
    "reassignment mid-cycle is instant for future sends; past Usage stays on the previous Billing User"
  );

  it.todo("requires billingUser:update (Owner only)");

  it.todo(
    "cannot leave or be removed from the Project while they are Billing User — reassign first (Better Auth hooks)"
  );
});
