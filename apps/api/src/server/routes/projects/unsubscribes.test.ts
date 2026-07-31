import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/unsubscribes).
 * Product language: shared/contacts/CONTEXT.md (Unsubscribe).
 */
describe("POST /projects/:orgSlug/unsubscribes", () => {
  it.todo(
    "sets global marketing opt-out on an existing Contact (allMarketing)"
  );

  it.todo("records a per-Topic Unsubscribe for an existing Contact");

  it.todo("rejects when the Contact or Topic is not in the Project");
});

describe("DELETE /projects/:orgSlug/unsubscribes/:contactId/allMarketing", () => {
  it.todo("clears global marketing opt-out on a Contact");
});

describe("DELETE /projects/:orgSlug/unsubscribes/:contactId/topics/:topicId", () => {
  it.todo("removes a per-Topic Unsubscribe from a Contact");
});
