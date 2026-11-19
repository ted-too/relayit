/**
 * The fake backend holds the same line SES does: a Domain is never registered onto, and a
 * removed Domain never deletes, an identity Relayit did not make.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { EmailBackend } from "@repo/channels/email/backend";
import { createCustomDomain } from "@repo/channels/email/custom-domain/lifecycle";
import { DnsLookups } from "@repo/channels/email/dns-lookups";
import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { recordedJobs } from "@repo/channels/email/recorded-jobs-test-layer";
import { SELF_HOSTED_LIMITS } from "@repo/persistence/auth/plans";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { organization, user, userChannel } from "@repo/persistence/db/schema";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { makeFakeEmailBackend } from "./fake";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;
const testName = "a Domain named as an identity Relayit did not make is refused, and it stays";

describe("fake email backend's identities (PostgreSQL and Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping fake email backend identity test: TEST_DATABASE_URL and TEST_REDIS_URL are not both set",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  it.live(testName, () => {
    // The real queue: a removal's delete job would go to the outbox, and be recorded here.
    const jobs = recordedJobs(testRedisUrl);
    const layer = Layer.mergeAll(
      EmailManagedDns.noop(),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:fake-identity-test-secret-0123456789")),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("unknown"),
        evaluate: () => Promise.resolve({ matches: true, warnings: [] }),
      }),
      jobs.layer,
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));

    return Effect.gen(function* () {
      const db = yield* DB;
      const fake = yield* makeFakeEmailBackend("fake");
      const organizationId = typeid("orgn").toString();
      // Adding a Domain reads the Billing User's Plan; this one's sets no Domain limit.
      const billingUserId = `user_${organizationId}`;
      yield* db
        .insert(user)
        .values({ email: `${billingUserId}@example.test`, id: billingUserId, name: "Billing" });
      yield* db.insert(userChannel).values({
        channelType: "email",
        limits: SELF_HOSTED_LIMITS.email,
        userId: billingUserId,
      });
      yield* db.insert(organization).values({
        billingUserId,
        id: organizationId,
        name: "Outside",
        slug: `outside-${organizationId}`,
      });
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      // As a person makes one in the SES console, or another system on the same account.
      yield* fake.addOutsideIdentity({ fqdn, region: null });

      const add = createCustomDomain({ fqdn, organizationId }).pipe(
        Effect.provideService(EmailBackend, fake),
      );
      expect(yield* Effect.flip(add)).toMatchObject({
        _tag: "CustomDomainIdentityConflict",
        fqdn,
      });
      expect(yield* db.query.customDomain.findFirst({ where: { fqdn } })).toBeUndefined();

      // The Domain that add wrote never had an identity: nothing is recorded or enqueued to
      // delete one, so trying the name again costs no more than the first time.
      expect(jobs.enqueued).toEqual([]);
      expect(yield* db.query.removedDomainIdentity.findMany({ where: { fqdn } })).toEqual([]);
      expect(yield* Effect.flip(add)).toMatchObject({ _tag: "CustomDomainIdentityConflict" });

      // A delete naming it, as the job of a Domain removed under that name would, deletes
      // nothing, where a Domain's own identity is deleted. The fake keeps no identity to look
      // at afterwards: that SES leaves one exactly as it was is `identity.test.ts`'s to show.
      const removed = { dkimSelector: "relayit0a1b2c3d", region: null };
      expect(yield* fake.deleteIdentity({ ...removed, fqdn })).toBe(false);
      expect(yield* fake.deleteIdentity({ ...removed, fqdn: `other-${fqdn}` })).toBe(true);

      // Another name is added as usual.
      const other = yield* createCustomDomain({
        fqdn: `other-${fqdn}`,
        organizationId,
      }).pipe(Effect.provideService(EmailBackend, fake));
      expect(other.kind).toBe("created");
    }).pipe(Effect.scoped, Effect.provide(layer));
  });
});
