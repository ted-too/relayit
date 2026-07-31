import { describe, it } from "vitest";

/**
 * Seam: HTTP API via Eden Treaty (`treaty(app)` → /projects/:orgSlug/contacts).
 * Product language: shared/contacts/CONTEXT.md.
 */
describe("/projects/:orgSlug/contacts", () => {
  it.todo(
    "POST upserts by normalized email within App Environment scope and revives soft-deleted Contacts"
  );

  it.todo(
    "POST keeps Suppression and Unsubscribe when reviving a soft-deleted Contact"
  );

  it.todo(
    "GET list returns active Contacts only with cursor keyset pagination (createdAt, id)"
  );

  it.todo("GET /:id returns soft-deleted Contacts in the Project");

  it.todo(
    "PATCH rejects primary-email collisions in the same App Environment with 409"
  );

  it.todo("PATCH on a soft-deleted Contact returns 404");

  it.todo("DELETE soft-deletes; repeat DELETE is idempotent");

  it.todo("soft-delete leaves Segment memberships intact");
});
