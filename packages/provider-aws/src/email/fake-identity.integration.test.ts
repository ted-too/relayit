/**
 * The fake backend holds the same line SES does: a Domain is never registered onto, and a
 * removed Domain never deletes, an identity Relayit did not make.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { EmailBackend } from "@repo/channels/email/backend";
import { emailDeleteDomainIdentityHandler } from "@repo/channels/email/custom-domain/handlers";
import type { EmailDeleteDomainIdentityPayload } from "@repo/channels/email/custom-domain/jobs";
import { createCustomDomain } from "@repo/channels/email/custom-domain/lifecycle";
import { DnsLookups } from "@repo/channels/email/dns-lookups";
import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { Jobs, type JobsService } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { organization } from "@repo/persistence/db/schema";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { makeFakeEmailBackend } from "./fake";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "a Domain named as an identity Relayit did not make is refused, and it stays";

describe("fake email backend's identities (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping fake email backend identity test: TEST_DATABASE_URL unset");
    // The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  it.live(testName, () => {
    const enqueued: EmailDeleteDomainIdentityPayload[] = [];
    const layer = Layer.mergeAll(
      EmailManagedDns.noop(),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:fake-identity-test-secret-0123456789")),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("unknown"),
        evaluate: () => Promise.resolve({ matches: true, warnings: [] }),
      }),
      // The queue is a boundary here: the identity delete a removal enqueues is run below.
      Layer.succeed(Jobs, {
        cancel: (() => Effect.void) as JobsService["cancel"],
        enqueue: ((_contract: unknown, payload: unknown) => {
          enqueued.push(payload as EmailDeleteDomainIdentityPayload);
          return Effect.void;
        }) as JobsService["enqueue"],
        schedule: (() => Effect.void) as JobsService["schedule"],
      }),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));

    return Effect.gen(function* () {
      const db = yield* DB;
      const fake = yield* makeFakeEmailBackend("fake");
      const organizationId = typeid("orgn").toString();
      yield* db
        .insert(organization)
        .values({ id: organizationId, name: "Outside", slug: `outside-${organizationId}` });
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

      // The Domain that add wrote is removed like any other, and the identity delete its
      // removal enqueued runs, with the selector of a Domain the identity was never made for.
      expect(enqueued).toMatchObject([{ fqdn, region: null }]);
      for (const payload of enqueued) {
        yield* emailDeleteDomainIdentityHandler
          .handle(payload, { attempt: 1, enqueuedAt: Date.now(), id: "job_delete_identity" })
          .pipe(Effect.provideService(EmailBackend, fake));
      }

      // The fake answered that it deleted nothing, so the handler kept the removal's record:
      // that the SES backend deletes nothing of an outside identity is `identity.test.ts`'s.
      expect(
        yield* db.query.removedDomainIdentity.findMany({
          columns: { dkimSelector: true },
          where: { fqdn },
        }),
      ).toEqual([{ dkimSelector: enqueued[0]?.dkimSelector }]);

      // The identity is still in the account, untouched: the name is refused as before.
      expect(yield* Effect.flip(add)).toMatchObject({ _tag: "CustomDomainIdentityConflict" });
      // In the region it is in, and under that name only.
      const other = yield* createCustomDomain({
        fqdn: `other-${fqdn}`,
        organizationId,
      }).pipe(Effect.provideService(EmailBackend, fake));
      expect(other.kind).toBe("created");
    }).pipe(Effect.scoped, Effect.provide(layer));
  });
});
