import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/segments).
 * Product language: shared/contacts/CONTEXT.md (Segment).
 * Static membership only in this pass.
 */
describe("POST /projects/:orgSlug/segments", () => {
  it.todo("creates a Project-scoped Segment for Campaign Send targeting only");
});

describe("POST /projects/:orgSlug/segments/:id/archive", () => {
  it.todo("archives a Segment so it cannot be targeted by new Campaign Sends");
});

describe("Segment members", () => {
  it.todo("adds active Contact IDs from the Project as static Segment members");

  it.todo(
    "rejects contactIds that are missing, soft-deleted, or outside the Project"
  );

  it.todo("removes a Contact from a Segment’s static membership");
});
