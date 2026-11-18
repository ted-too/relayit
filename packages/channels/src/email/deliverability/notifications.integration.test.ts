import { describe, expect, it, test } from "@effect/vitest";
import { JobsLive } from "@repo/jobs";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  customDomain,
  emailDelivery,
  emailDeliveryEvent,
  message,
  organization,
  organizationAppEnvironment,
  organizationDomain,
  sandboxDomain,
  webhookEndpoint,
  webhookEvent,
} from "@repo/persistence/db/schema";
import { makeRedisLive } from "@repo/redis";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { deleteCustomDomain } from "../custom-domain/lifecycle";
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

  // SES took the message a moment ago, as when its notifications usually arrive.
  const ingest = (event: Omit<NormalizedDeliveryEvent, "providerMessageId" | "sentAt">) =>
    ingestDeliveryEvents(db, { events: [{ ...event, providerMessageId, sentAt: new Date() }] });
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
  return { deliveryId: delivery?.id ?? "", ingest, organizationId, providerMessageId, recorded };
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

  it.live("concurrent bounces naming the same recipients in opposite orders both apply", () =>
    Effect.gen(function* () {
      const { ingest, recorded } = yield* sentDelivery;
      const bounce = (recipients: readonly string[]) =>
        ingest({
          kind: "bounced",
          notificationId: Bun.randomUUIDv7(),
          raw: { bounce: { bounceType: "Permanent" } },
          recipients,
          suppress: true,
        });
      const recipients = ["to@example.com", "copied@example.com", "hidden@example.com"];

      yield* Effect.all(
        Array.from({ length: 20 }, (_, index) =>
          bounce(index % 2 === 0 ? recipients : recipients.toReversed()),
        ),
        { concurrency: "unbounded" },
      );

      expect((yield* recorded).events).toHaveLength(20);
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

  it.live(
    "a bounce that beats its Delivery's sent write is refused, then recorded when SNS sends it again",
    () =>
      Effect.gen(function* () {
        const db = yield* DB;
        const { deliveryId, ingest, providerMessageId, recorded } = yield* sentDelivery;
        // SES has the message; the worker has claimed the Delivery and not yet recorded SES's
        // answer.
        yield* db
          .update(emailDelivery)
          .set({ providerMessageId: null, status: "sending" })
          .where(eq(emailDelivery.id, deliveryId));
        const bounce = {
          kind: "bounced",
          notificationId: Bun.randomUUIDv7(),
          raw: { bounce: { bounceType: "Permanent" } },
          recipients: ["to@example.com"],
          suppress: true,
        } as const;

        // Not acknowledged: the api answers SNS with a 500 and SNS sends it again.
        expect(yield* ingest(bounce).pipe(Effect.flip)).toMatchObject({
          _tag: "DeliveryNotRecordedYet",
          providerMessageId,
        });
        expect(yield* recorded).toEqual({ events: [], suppressed: [], webhooks: [] });

        yield* db
          .update(emailDelivery)
          .set({ providerMessageId, status: "sent" })
          .where(eq(emailDelivery.id, deliveryId));
        yield* ingest(bounce);

        expect(yield* recorded).toEqual({
          events: ["bounced"],
          suppressed: [{ email: "to@example.com", reason: "hard_bounce", severity: "all" }],
          webhooks: ["delivery.bounced"],
        });
      }).pipe(Effect.provide(services)),
  );

  it.live(
    "a bounce for a Delivery whose Domain is gone is recorded and suppresses, and touches no other Domain",
    () =>
      Effect.gen(function* () {
        const db = yield* DB;
        const { deliveryId, ingest, organizationId, recorded } = yield* sentDelivery;
        const fqdn = `${Bun.randomUUIDv7()}.example.test`;
        const heldDomain = (projectId: string) =>
          Effect.gen(function* () {
            const [domain] = yield* db
              .insert(customDomain)
              .values({
                dkimPrivateKey: "private",
                dkimPublicKey: "public",
                dkimSelector: "relayit",
                fqdn,
                verificationStatus: "verified",
              })
              .returning({ id: customDomain.id });
            if (!domain) {
              return yield* Effect.die("The Domain was written");
            }
            yield* db.insert(organizationDomain).values({
              customDomainId: domain.id,
              organizationId: projectId,
              ownershipToken: Bun.randomUUIDv7(),
              ownershipVerificationStatus: "verified",
            });
            return domain.id;
          });
        const eventSenders = db
          .select({
            customDomainId: emailDeliveryEvent.customDomainId,
            kind: emailDeliveryEvent.kind,
          })
          .from(emailDeliveryEvent)
          .where(eq(emailDeliveryEvent.emailDeliveryId, deliveryId))
          .orderBy(emailDeliveryEvent.createdAt);

        // Sent from the Project's own Domain, and reported delivered while it was held.
        const customDomainId = yield* heldDomain(organizationId);
        yield* db
          .update(emailDelivery)
          .set({ customDomainId, sandboxDomainId: null })
          .where(eq(emailDelivery.id, deliveryId));
        yield* ingest({
          kind: "delivered",
          notificationId: Bun.randomUUIDv7(),
          raw: {},
          recipients: ["to@example.com"],
          suppress: false,
        });
        expect(yield* eventSenders).toEqual([{ customDomainId, kind: "delivered" }]);

        // The Project removes the Domain and another adds the same FQDN: a new Domain.
        yield* deleteCustomDomain({ customDomainId, organizationId });
        const otherId = typeid("orgn").toString();
        yield* db.insert(organization).values({
          id: otherId,
          name: "Next holder",
          slug: `next-${Bun.randomUUIDv7()}`,
        });
        const nextDomainId = yield* heldDomain(otherId);

        yield* ingest({
          kind: "bounced",
          notificationId: Bun.randomUUIDv7(),
          raw: { bounce: { bounceType: "Permanent" } },
          recipients: ["to@example.com"],
          suppress: true,
        });

        // Both outcomes are the Delivery's still, the address is suppressed where it was
        // sent from, and the sender hears of the bounce.
        expect(yield* eventSenders).toEqual([
          { customDomainId: null, kind: "delivered" },
          { customDomainId: null, kind: "bounced" },
        ]);
        expect(yield* recorded).toEqual({
          events: ["delivered", "bounced"],
          suppressed: [{ email: "to@example.com", reason: "hard_bounce", severity: "all" }],
          webhooks: ["delivery.delivered", "delivery.bounced"],
        });
        // The Domain that has the FQDN now gains no event and is not paused.
        expect(
          yield* db
            .select({ id: emailDeliveryEvent.id })
            .from(emailDeliveryEvent)
            .where(eq(emailDeliveryEvent.customDomainId, nextDomainId)),
        ).toEqual([]);
        expect(
          yield* db
            .select({ isPaused: customDomain.isPaused, status: customDomain.verificationStatus })
            .from(customDomain)
            .where(eq(customDomain.fqdn, fqdn)),
        ).toEqual([{ isPaused: false, status: "verified" }]);
        expect(
          yield* db
            .select({ type: webhookEvent.type })
            .from(webhookEvent)
            .where(eq(webhookEvent.organizationId, otherId)),
        ).toEqual([]);
      }).pipe(Effect.provide(services)),
  );

  it.live("a notification about a message no Delivery carries is acknowledged once it is old", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const { recorded } = yield* sentDelivery;
      const unknown = {
        kind: "bounced",
        notificationId: Bun.randomUUIDv7(),
        providerMessageId: `ses-${Bun.randomUUIDv7()}`,
        raw: {},
        recipients: ["to@example.com"],
        suppress: true,
      } as const;

      // Sent long enough ago that the worker would have recorded it, at a time the
      // notification does not give, or (a forged one) far in the future: SNS is not made to
      // retry any of them.
      for (const sentAt of [
        new Date(Date.now() - 2 * 3_600_000),
        null,
        new Date(Date.now() + 2 * 3_600_000),
      ]) {
        yield* ingestDeliveryEvents(db, { events: [{ ...unknown, sentAt }] });
      }

      expect(yield* recorded).toEqual({ events: [], suppressed: [], webhooks: [] });
    }).pipe(Effect.provide(services)),
  );
});
