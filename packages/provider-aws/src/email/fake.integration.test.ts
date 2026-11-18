import { describe, expect, test } from "bun:test";
import { createCustomDomain } from "@repo/channels/email/custom-domain/lifecycle";
import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { EmailBackend } from "@repo/channels/email/backend";
import { verifyCustomDomainRegistration } from "@repo/channels/email/verification/custom-identity";
import { Jobs, JobsLive } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  contact,
  emailDelivery,
  message,
  organization,
  organizationAppEnvironment,
  webhookEndpoint,
} from "@repo/persistence/db/schema";
import { makeRedisClient, makeRedisLive } from "@repo/redis";
import { Effect, Layer, Schedule } from "effect";
import { typeid } from "typeid-js";
import { emailBackendLayer } from "./backend";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;
const testName =
  "a Domain verifies without AWS, and a bounce simulator send suppresses its Contact";

describe("fake email backend (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping fake email backend test: TEST_DATABASE_URL or TEST_REDIS_URL unset",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  test(testName, async () => {
    const run = Bun.randomUUIDv7();
    const keyPrefix = `test:${run}:`;
    const secrets = parseBetterAuthSecrets("1:fake-backend-test-secret-0123456789");
    const dbLive = makeDbLive({ databaseUrl: testDatabaseUrl });
    const jobsLive = JobsLive.pipe(Layer.provide(makeRedisLive({ keyPrefix, url: testRedisUrl })));
    const layer = Layer.mergeAll(
      emailBackendLayer({ defaultRegion: "fake", kind: "fake" }),
      EmailManagedDns.noop(),
      SymmetricCrypto.live(secrets),
    ).pipe(Layer.provideMerge(Layer.mergeAll(dbLive, jobsLive)));

    const program = Effect.gen(function* () {
      const db = yield* DB;
      yield* Jobs;
      const organizationId = typeid("orgn").toString();
      const environmentId = typeid("oenv").toString();
      const fqdn = `${run}.example.test`;
      const bounceAddress = "bounce@simulator.amazonses.com";

      yield* db
        .insert(organization)
        .values({ id: organizationId, name: "Fake backend", slug: `fake-${run}` });
      yield* db.insert(organizationAppEnvironment).values({ id: environmentId, organizationId });
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId });
      const domain = yield* db.query.customDomain.findFirst({
        where: { id: customDomainId },
        with: { registration: true },
      });
      if (!domain?.registration) {
        return yield* Effect.die("Domain has no registration");
      }
      expect(domain.registration.region).toBe("fake");
      const verified = yield* verifyCustomDomainRegistration({
        db,
        domain,
        registration: domain.registration,
      });
      expect(verified.verificationStatus).toBe("verified");

      const messageId = typeid("msg").toString();
      yield* db.insert(message).values({
        id: messageId,
        organizationAppEnvironmentId: environmentId,
        purpose: "transactional",
      });
      yield* db
        .insert(contact)
        .values({ email: bounceAddress, organizationAppEnvironmentId: environmentId });
      yield* db.insert(webhookEndpoint).values({
        eventTypes: ["delivery.bounced"],
        organizationId,
        signingSecret: "whsec_test",
        url: "https://receiver.example.test/hooks",
      });

      const backend = yield* EmailBackend;
      const from = { address: `hello@${fqdn}`, normalized: `hello@${fqdn}` };
      const sent = yield* backend.send({
        message: {
          bcc: null,
          cc: null,
          from,
          headers: null,
          html: null,
          replyTo: null,
          sender: { identityFqdn: fqdn, projectId: organizationId },
          subject: "Bounce me",
          text: "Hello",
          to: [bounceAddress],
        },
        region: domain.registration.region,
      });
      // What the worker writes once send returns; the simulated bounce waits for it.
      yield* db.insert(emailDelivery).values({
        customDomainId,
        from,
        messageId,
        providerMessageId: sent.providerMessageId,
        status: "sent",
        subject: "Bounce me",
        text: "Hello",
        to: [bounceAddress],
      });

      const suppressed = yield* db.query.contact
        .findFirst({ where: { email: bounceAddress, organizationAppEnvironmentId: environmentId } })
        .pipe(
          Effect.filterOrFail((row) => row?.suppressedAt != null),
          Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
        );
      expect(suppressed).toMatchObject({
        suppressionReason: "hard_bounce",
        suppressionSeverity: "all",
      });
      const events = yield* db.query.webhookEvent.findMany({ where: { organizationId } });
      expect(events.map((event) => event.type)).toEqual(["delivery.bounced"]);
    });

    try {
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    } finally {
      const client = makeRedisClient({ url: testRedisUrl });
      let cursor = "0";
      do {
        const [next, keys] = (await client.send("SCAN", [
          cursor,
          "MATCH",
          `${keyPrefix}*`,
          "COUNT",
          "100",
        ])) as [string, string[]];
        cursor = next;
        if (keys.length > 0) {
          await client.send("DEL", keys);
        }
      } while (cursor !== "0");
      client.close();
    }
  });
});
