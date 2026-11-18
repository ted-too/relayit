import { describe, expect, it, test } from "@effect/vitest";
import { JobsLive } from "@repo/jobs";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  emailDelivery,
  emailDeliveryEvent,
  message,
  organization,
  organizationAppEnvironment,
  sandboxDomain,
  webhookEndpoint,
  webhookEvent,
} from "@repo/persistence/db/schema";
import { makeRedisLive } from "@repo/redis";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { ingestDeliveryEvents, type NormalizedDeliveryEvent } from "./notifications";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

/** A Project with a Webhook Endpoint for every delivery event, and one sent Delivery. */
const sentDelivery = Effect.gen(function* () {
  const db = yield* DB;
  const organizationId = typeid("orgn").toString();
  const environmentId = typeid("oenv").toString();
  const messageId = typeid("msg").toString();
  const sandboxDomainId = typeid("sbxd").toString();
  const providerMessageId = `ses-${Bun.randomUUIDv7()}`;

  yield* db.insert(organization).values({
    id: organizationId,
    name: "Notifications",
    slug: `notifications-${Bun.randomUUIDv7()}`,
  });
  yield* db.insert(organizationAppEnvironment).values({ id: environmentId, organizationId });
  yield* db.insert(sandboxDomain).values({
    cloudflareZoneId: "zone",
    dkimPrivateKey: "private",
    dkimPublicKey: "public",
    dkimSelector: "relayit",
    id: sandboxDomainId,
    rootDomain: `${Bun.randomUUIDv7()}.relayit.test`,
  });
  yield* db.insert(webhookEndpoint).values({
    eventTypes: ["delivery.bounced", "delivery.complained", "delivery.delivered"],
    organizationId,
    signingSecret: "secret",
    url: "https://hooks.example.com/relayit",
  });
  yield* db.insert(message).values({
    id: messageId,
    organizationAppEnvironmentId: environmentId,
    purpose: "transactional",
  });
  const [delivery] = yield* db
    .insert(emailDelivery)
    .values({
      bcc: ["hidden@example.com"],
      cc: ["Copied@Example.com"],
      from: { address: "hello@relayit.test", normalized: "hello@relayit.test" },
      messageId,
      providerMessageId,
      sandboxDomainId,
      status: "sent",
      subject: "Hi",
      text: "Hi",
      to: ["to@example.com"],
    })
    .returning({ id: emailDelivery.id });
  yield* db
    .insert(contact)
    .values(
      ["to@example.com", "copied@example.com", "hidden@example.com", "bystander@example.com"].map(
        (email) => ({ email, organizationAppEnvironmentId: environmentId }),
      ),
    );

  const ingest = (event: Omit<NormalizedDeliveryEvent, "providerMessageId">) =>
    ingestDeliveryEvents(db, { events: [{ ...event, providerMessageId }] });
  const recorded = Effect.gen(function* () {
    const events = yield* db
      .select({ kind: emailDeliveryEvent.kind })
      .from(emailDeliveryEvent)
      .where(eq(emailDeliveryEvent.emailDeliveryId, delivery?.id ?? ""));
    const webhooks = yield* db
      .select({ type: webhookEvent.type })
      .from(webhookEvent)
      .where(eq(webhookEvent.organizationId, organizationId));
    const contacts = yield* db
      .select({
        email: contact.email,
        reason: contact.suppressionReason,
        severity: contact.suppressionSeverity,
      })
      .from(contact)
      .where(eq(contact.organizationAppEnvironmentId, environmentId))
      .orderBy(contact.email);
    return {
      events: events.map(({ kind }) => kind),
      suppressed: contacts.filter(({ reason }) => reason !== null),
      webhooks: webhooks.map(({ type }) => type),
    };
  });
  return { ingest, providerMessageId, recorded };
});

describe("ingestDeliveryEvents", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping SES notification ingest tests: TEST_DATABASE_URL and TEST_REDIS_URL are not set",
    );
    // The PostgreSQL test is opt-in.
    test.skip("SES notification ingest", () => undefined);
    return;
  }

  const services = Layer.mergeAll(
    makeDbLive({ databaseUrl: testDatabaseUrl }),
    JobsLive.pipe(
      Layer.provide(makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: testRedisUrl })),
    ),
  );

  it.live(
    "a hard bounce records its event and Webhook Event and suppresses only the Delivery's recipients",
    () =>
      Effect.gen(function* () {
        const { ingest, recorded } = yield* sentDelivery;

        yield* ingest({
          kind: "bounced",
          notificationId: Bun.randomUUIDv7(),
          raw: { bounce: { bounceType: "Permanent" } },
          recipients: ["TO@example.com", "copied@example.com", "bystander@example.com"],
          suppress: true,
        });

        expect(yield* recorded).toEqual({
          events: ["bounced"],
          suppressed: [
            { email: "copied@example.com", reason: "hard_bounce", severity: "all" },
            { email: "to@example.com", reason: "hard_bounce", severity: "all" },
          ],
          webhooks: ["delivery.bounced"],
        });
      }).pipe(Effect.provide(services)),
  );

  it.live("a redelivered notification is recorded once, however it arrives", () =>
    Effect.gen(function* () {
      const { ingest, recorded } = yield* sentDelivery;
      const complaint = {
        kind: "complained",
        notificationId: Bun.randomUUIDv7(),
        raw: { complaint: { complaintFeedbackType: "abuse" } },
        recipients: ["hidden@example.com"],
        suppress: true,
      } as const;

      yield* Effect.all([ingest(complaint), ingest(complaint)], { concurrency: "unbounded" });
      yield* ingest(complaint);

      expect(yield* recorded).toEqual({
        events: ["complained"],
        suppressed: [{ email: "hidden@example.com", reason: "complaint", severity: "marketing" }],
        webhooks: ["delivery.complained"],
      });
    }).pipe(Effect.provide(services)),
  );

  it.live("separate notifications about one Delivery are each recorded", () =>
    Effect.gen(function* () {
      const { ingest, recorded } = yield* sentDelivery;
      const delivered = {
        kind: "delivered",
        raw: {},
        recipients: ["to@example.com"],
        suppress: false,
      } as const;

      yield* ingest({ ...delivered, notificationId: Bun.randomUUIDv7() });
      yield* ingest({ ...delivered, notificationId: Bun.randomUUIDv7() });

      expect(yield* recorded).toEqual({
        events: ["delivered", "delivered"],
        suppressed: [],
        webhooks: ["delivery.delivered", "delivery.delivered"],
      });
    }).pipe(Effect.provide(services)),
  );

  it.live("a soft bounce records its event without suppressing", () =>
    Effect.gen(function* () {
      const { ingest, recorded } = yield* sentDelivery;

      yield* ingest({
        kind: "bounced",
        notificationId: Bun.randomUUIDv7(),
        raw: { bounce: { bounceType: "Transient" } },
        recipients: ["to@example.com"],
        suppress: false,
      });

      expect(yield* recorded).toEqual({
        events: ["bounced"],
        suppressed: [],
        webhooks: ["delivery.bounced"],
      });
    }).pipe(Effect.provide(services)),
  );

  it.live("a notification about no known Delivery changes nothing", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { recorded } = yield* sentDelivery;

      yield* ingestDeliveryEvents(db, {
        events: [
          {
            kind: "bounced",
            notificationId: Bun.randomUUIDv7(),
            providerMessageId: `ses-${Bun.randomUUIDv7()}`,
            raw: {},
            recipients: ["to@example.com"],
            suppress: true,
          },
        ],
      });

      expect(yield* recorded).toEqual({ events: [], suppressed: [], webhooks: [] });
    }).pipe(Effect.provide(services)),
  );
});
