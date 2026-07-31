import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty
 * (`treaty(app)` → /projects/:orgSlug/apiKeys).
 * Product language: shared/tenancy/CONTEXT.md (API Key, Project).
 * Path segments are camelCase for Eden Treaty (see ADR-0004).
 *
 * Auth: session + Project slug (Better Auth organization). Full Eden tests need
 * a session/test Project harness — keep behavioral todos until that exists.
 */
describe("POST /projects/:orgSlug/apiKeys", () => {
  it.todo(
    "creates a credential scoped to a Project (not App or App Environment)"
  );
});

describe("GET /projects/:orgSlug/apiKeys", () => {
  it.todo("lists API keys for the Project");
});

describe("PUT /projects/:orgSlug/apiKeys/:id", () => {
  it.todo("updates name / expiry on an existing Project API key");
});
