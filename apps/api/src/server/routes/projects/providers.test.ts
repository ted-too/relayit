import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/providers).
 * Product language: shared/channels/CONTEXT.md (Provider); ADR-0006.
 */
describe("GET /projects/:orgSlug/providers", () => {
  it.todo(
    "lists Project BYO Providers plus selectable managed backends and current defaultManagedProviderId"
  );
});

describe("POST /projects/:orgSlug/providers/byVendor/:vendorId/:productId", () => {
  it.todo("adds a Project-owned BYO email Provider");

  it.todo(
    "rejects BYO create in cloud when Billing User Plan byoProviders is false"
  );

  it.todo("allows BYO create on self-hosted regardless of Plan matrix");
});

describe("DELETE /projects/:orgSlug/providers/:providerId", () => {
  it.todo("allows removing a BYO Provider with no Domain pairings");

  it.todo("rejects delete while a Domain↔Provider pairing still references it");
});
