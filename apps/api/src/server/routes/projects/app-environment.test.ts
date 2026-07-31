import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty
 * (`treaty(app)` → /projects/:orgSlug/appEnvironments).
 * Product language: shared/tenancy/CONTEXT.md (App Environment).
 *
 * No management create — rows materialise on send via findOrCreateAppEnvironment.
 */
describe("GET /projects/:orgSlug/appEnvironments", () => {
  it.todo(
    "lists App Environment rows for the Project, including the default (app and environment both null) when present"
  );

  it.todo(
    "returns an empty list when the Project has never materialised an App Environment via send"
  );

  it.todo("rejects when the caller lacks appEnvironment read permission");
});

describe("DELETE /projects/:orgSlug/appEnvironments/:id", () => {
  it.todo(
    "hard-deletes a non-default App Environment and cascades scoped Contacts and Messages"
  );

  it.todo(
    "rejects deleting the Project default App Environment (app and environment both null)"
  );

  it.todo("rejects when the App Environment is not in the caller’s Project");

  it.todo("rejects when the caller lacks appEnvironment delete permission");
});
