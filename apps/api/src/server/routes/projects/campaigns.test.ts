import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/campaigns).
 * Product language: shared/messages/CONTEXT.md — Campaign definition (not Send).
 *
 * Stubs only — un-todo when auth harness exists.
 * When live:
 *   import { treaty } from "@elysiajs/eden";
 *   import { app } from "@repo/api/server";
 *   const api = treaty(app);
 *   await api.projects({ orgSlug }).campaigns.post({ ... }, { headers: { ... } });
 */
describe("POST /projects/:orgSlug/campaigns", () => {
  it.todo(
    "creates a Project-scoped Campaign with name, active Topic, and active Template"
  );

  it.todo("rejects create when Topic is archived");

  it.todo("rejects create when Template is archived");

  it.todo("rejects a duplicate active name with 409");

  it.todo("allows create without any channel From");
});

describe("GET /projects/:orgSlug/campaigns", () => {
  it.todo("lists Campaigns including archived ones and channel Froms");
});

describe("GET /projects/:orgSlug/campaigns/:id", () => {
  it.todo(
    "returns the Campaign by id including Topic, Template, and channel Froms"
  );

  it.todo("rejects when the Campaign is not in the caller’s Project");
});

describe("PATCH /projects/:orgSlug/campaigns/:id", () => {
  it.todo("updates name, Topic, and/or Template on an active Campaign");

  it.todo("rejects updates to an archived Campaign with 409");

  it.todo("rejects patch when the new Topic or Template is archived");
});

describe("POST /projects/:orgSlug/campaigns/:id/archive", () => {
  it.todo(
    "archives a Campaign so it cannot start new Campaign Sends; frees the name"
  );

  it.todo("is idempotent when the Campaign is already archived");
});

describe("PUT /projects/:orgSlug/campaigns/:id/channels/email", () => {
  it.todo(
    "sets a send-ready email From (verified Domain or Sandbox Domain in Project)"
  );

  it.todo("rejects a From that is not send-ready for this Project");

  it.todo("rejects channel From mutations on an archived Campaign");
});

describe("DELETE /projects/:orgSlug/campaigns/:id/channels/email", () => {
  it.todo("clears the email From; Campaign remains without that channel From");

  it.todo("rejects clear on an archived Campaign");
});

/**
 * Deferred — Campaign Send is out of this management slice.
 * Keep stubs here so the seam stays documented next to Campaign CRUD.
 */
describe("Campaign Send (deferred)", () => {
  it.todo(
    "fans out Messages at accept with Purpose=marketing from the Campaign Template"
  );

  it.todo(
    "inherits per-channel From from the Campaign unless an allowlisted override supplies from"
  );

  it.todo(
    "fails when the Campaign’s Topic or Template is archived until reassigned"
  );

  it.todo("fails when the Campaign is archived");

  it.todo("fails when a requested channel has no From on the Campaign");
});
