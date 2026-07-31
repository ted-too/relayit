import { describe, it } from "vitest";

/**
 * Temporary compat: old prod paths → Accept.
 * Prefer POST /messages/email for new clients.
 */
describe("POST /send/:project/raw/email", () => {
  it.todo("maps legacy raw body to Accept and returns { id, status: queued }");
});

describe("POST /send/:project/template/email", () => {
  it.todo("resolves template.slug and returns { id, status: queued }");

  it.todo("defaults omitted from to the Project Sandbox From address");
});
