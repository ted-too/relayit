import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/suppressions).
 * Product language: shared/contacts/CONTEXT.md (manual Suppression).
 * Requires an existing Contact; stored on the Contact row (soft-delete survives).
 */
describe("POST /projects/:orgSlug/suppressions", () => {
  it.todo(
    "manually suppresses an existing Contact with severity marketing or all"
  );

  it.todo("rejects when the Contact does not exist in the Project");
});

describe("DELETE /projects/:orgSlug/suppressions/:contactId", () => {
  it.todo("manually removes Suppression from a Contact");
});

describe("GET /projects/:orgSlug/suppressions", () => {
  it.todo(
    "lists Contacts with Suppression set, including soft-deleted Contacts"
  );
});
