import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/topics).
 * Product language: shared/contacts/CONTEXT.md (Topic).
 */
describe("POST /projects/:orgSlug/topics", () => {
  it.todo(
    "creates a Project-scoped Topic for marketing consent (not targeting)"
  );
});

describe("GET /projects/:orgSlug/topics", () => {
  it.todo("lists Topics for the Project including archived ones");
});

describe("POST /projects/:orgSlug/topics/:id/archive", () => {
  it.todo("archives a Topic so it cannot be chosen for new Campaigns");

  it.todo("is idempotent when the Topic is already archived");
});
