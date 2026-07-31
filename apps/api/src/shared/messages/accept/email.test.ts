import type { SendEmailBody } from "@repo/api/validators/routes/messages";
import { describe, expect, it } from "vitest";
import { acceptTransactionalEmail } from "./email";

/**
 * Seam: `acceptTransactionalEmail` (Messages Accept) — not HTTP.
 * Product language: shared/messages/CONTEXT.md + ADR-0001.
 * HTTP Eden tests in server/routes/messages/email-send.test.ts wrap this later.
 * Fake Redis/DB via injected clients when the harness exists; do not mock Channels modules.
 */
describe("acceptTransactionalEmail", () => {
  const baseBody = {
    from: {
      address: "noreply@example.com",
      normalized: "noreply@example.com",
    },
    to: [{ email: "user@example.com" }],
    subject: "Hello",
    html: "<p>Hi</p>",
  } satisfies SendEmailBody;

  it("rejects when only App header is present (Environment required as a pair)", async () => {
    const result = await acceptTransactionalEmail({
      // biome-ignore lint/suspicious/noExplicitAny: validation runs before db/redis
      db: null as any,
      // biome-ignore lint/suspicious/noExplicitAny: validation runs before db/redis
      redis: null as any,
      organizationId: "org_test",
      app: "checkout",
      body: baseBody,
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "invalid_app_environment",
      message:
        "App and Environment headers must both be present, or both omitted.",
    });
  });

  it("rejects when only Environment header is present", async () => {
    const result = await acceptTransactionalEmail({
      // biome-ignore lint/suspicious/noExplicitAny: validation runs before db/redis
      db: null as any,
      // biome-ignore lint/suspicious/noExplicitAny: validation runs before db/redis
      redis: null as any,
      organizationId: "org_test",
      environment: "prod",
      body: baseBody,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_app_environment");
    }
  });

  it.todo(
    "accepts inline content and returns a Message id (Purpose=transactional) — needs DB/Redis harness"
  );

  it.todo(
    "renders a primitive Template (id or slug) into Delivery Channel Format — needs DB/Redis harness"
  );
});
