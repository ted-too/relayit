/** Which URLs a Webhook Endpoint may be saved with, against a real database. */
import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { organization, webhookEndpoint } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { typeid } from "typeid-js";
import { createWebhookEndpoint, updateWebhookEndpoint } from "./endpoints";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const REFUSED = [
  "http://hooks.example.com/relayit",
  "file:///proc/self/environ",
  "hooks.example.com/relayit",
  "https://127.0.0.1/relayit",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/relayit",
  `https://${"a".repeat(254)}/relayit`,
];

describe("a Webhook Endpoint's URL (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Webhook Endpoint tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("Webhook Endpoint URLs", () => undefined);
    return;
  }

  /** A Project, and the URLs of its Endpoints as stored. */
  const project = Effect.gen(function* () {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Endpoints",
      slug: `endpoints-${Bun.randomUUIDv7()}`,
    });
    const stored = db
      .select({ url: webhookEndpoint.url })
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.organizationId, organizationId))
      .pipe(Effect.map((rows) => rows.map(({ url }) => url)));
    return { db, organizationId, stored };
  });

  it.live("is saved on create when it is an https URL, and refused otherwise", () =>
    Effect.gen(function* () {
      const { db, organizationId, stored } = yield* project;
      const create = (url: string) =>
        db.transaction((transaction) =>
          createWebhookEndpoint(transaction, {
            enabled: true,
            eventTypes: ["message.sent"],
            organizationId,
            url,
          }),
        );

      for (const url of REFUSED) {
        expect(yield* Effect.flip(create(url))).toMatchObject({
          _tag: "WebhookManagementError",
          code: "invalid_url",
        });
      }
      expect(yield* stored).toEqual([]);

      // A hostname is not looked up here; a literal public address is taken too.
      for (const url of ["https://hooks.example.com/relayit?t=1", "https://93.184.215.14/hook"]) {
        expect(yield* create(url)).toMatchObject({ url });
      }
      expect(yield* stored).toEqual([
        "https://hooks.example.com/relayit?t=1",
        "https://93.184.215.14/hook",
      ]);
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );

  it.live("is changed on update when it is an https URL, and left as it was otherwise", () =>
    Effect.gen(function* () {
      const { db, organizationId, stored } = yield* project;
      const [endpoint] = yield* db
        .insert(webhookEndpoint)
        .values({
          eventTypes: ["message.sent"],
          organizationId,
          signingSecret: "secret",
          url: "https://hooks.example.com/old",
        })
        .returning({ id: webhookEndpoint.id });
      const update = (url: string) =>
        db.transaction((transaction) =>
          updateWebhookEndpoint(transaction, {
            endpointId: endpoint?.id ?? "",
            organizationId,
            url,
          }),
        );

      for (const url of REFUSED) {
        expect(yield* Effect.flip(update(url))).toMatchObject({
          _tag: "WebhookManagementError",
          code: "invalid_url",
        });
      }
      expect(yield* stored).toEqual(["https://hooks.example.com/old"]);

      expect(yield* update("https://hooks.example.com/new")).toMatchObject({
        url: "https://hooks.example.com/new",
      });
      expect(yield* stored).toEqual(["https://hooks.example.com/new"]);
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );
});
