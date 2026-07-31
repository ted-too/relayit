import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty
 * (`treaty(app)` → /projects/:orgSlug/templating/workspace/:kind).
 * Product language: shared/messages/CONTEXT.md; ADR-0005.
 */
describe("GET /projects/:orgSlug/templating/workspace/:kind", () => {
  it.todo("soft-creates the Project hosted workspace for kind reactEmail");
});

describe("GET /projects/:orgSlug/templating/workspace/:kind/entries", () => {
  it.todo(
    "lists active entries with pickable=false until a successful Publish"
  );
});

describe("hosted Git + Publish (templating-builder BFF)", () => {
  it.todo("commits draft files to Git-in-S3 on the builder via API BFF");

  it.todo("deps sync regenerates lockfile without advancing main");

  it.todo(
    "Publish builds from dev and advances main + live artifacts only on success"
  );

  it.todo("preview ephemeral-seals an Entry from dev without advancing main");
});
