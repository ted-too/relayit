import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/usage).
 * Product language: Messages Usage + Tenancy Plan / Billing Period / Billing User.
 * Read-only entitlements surface — send-time rejection remains on Message / Campaign Send APIs.
 */
describe("GET /projects/:orgSlug/usage", () => {
  it.todo(
    "returns current Billing Period Usage for the Project’s Billing User, bucketed by Purpose × Channel × Provider kind (managed vs BYO)"
  );

  it.todo(
    "returns Plan limits alongside consumed Usage for each bucket (monthly + daily)"
  );

  it.todo(
    "uses Stripe subscription period when subscribed; otherwise anniversary of user.createdAt"
  );

  it.todo("aggregates across all Projects that share the same Billing User");

  it.todo("does not count skips and cancels before send toward consumed Usage");

  it.todo("requires usage:read permission");
});
