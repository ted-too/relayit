import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty
 * (`treaty(app)` → /projects/:orgSlug/templating/templates).
 * Product language: shared/messages/CONTEXT.md; ADR-0005.
 */
describe("POST /projects/:orgSlug/templating/templates", () => {
  it.todo(
    "creates a Project-scoped Template with name and auto-generates a unique slug"
  );
});

describe("GET /projects/:orgSlug/templating/templates", () => {
  it.todo("lists Templates including per-channel variants and broken flags");
});

describe("PATCH /projects/:orgSlug/templating/templates/:id", () => {
  it.todo("updates name and regenerates slug to track the new name");

  it.todo("rejects updates to an archived Template");
});

describe("PUT /projects/:orgSlug/templating/templates/:id/channels/email", () => {
  it.todo(
    "sets a primitive email variant (content + Resend-shaped Template Variables)"
  );

  it.todo("links a reactEmail variant to a pickable Workspace Entry by id");

  it.todo(
    "rejects linking a Workspace Entry that has not been published successfully"
  );
});

describe("POST /projects/:orgSlug/templating/templates/:id/archive", () => {
  it.todo("archives a Template");
});

describe("Template at Message create", () => {
  it.todo(
    "renders a primitive Template into Delivery Channel Format with variables/fallbacks"
  );

  it.todo(
    "renders a reactEmail Template from the linked Entry’s sealed artifact"
  );
});
