/**
 * A Plan's Domain limit against a real Postgres: which adds and claims it refuses, what
 * counts toward it, and that a `user_channel.limits` row it cannot read refuses the add
 * instead of allowing it. SES, public DNS and the job queue are the boundaries stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { member, organization, user } from "@repo/persistence/db/schema";
import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { completeDomainClaimTransfer, createCustomDomain, deleteCustomDomain } from "./lifecycle";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const UNCAPPED_SENDS = { dailySends: null, monthlySends: null };

describe("a Plan's Domain limit (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Domain limit tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("refuses one Domain more than the Plan allows", () => undefined);
    return;
  }

  const live = Layer.mergeAll(
    Layer.succeed(EmailBackend, {
      createIdentity: ({ fqdn }) =>
        Effect.succeed({ mailFrom: { domain: `send.${fqdn}`, records: [] } }),
      defaultRegion: "eu-central-1",
      deleteIdentity: () => Effect.succeed(true),
      ensureInfrastructure: () => Effect.void,
      getIdentityStatus: () => Effect.die("unused"),
      getProjectSendingStatus: () => Effect.die("unused"),
      send: () => Effect.die("unused"),
    }),
    Layer.succeed(DnsLookups, {
      detectProvider: () => Promise.resolve("cloudflare"),
      evaluate: () => Promise.resolve({ matches: false, warnings: [] }),
    }),
    Layer.succeed(Jobs, {
      cancel: () => Effect.void,
      enqueue: () => Effect.void,
      schedule: () => Effect.void,
    } as unknown as JobsService),
    EmailManagedDns.noop(),
    SymmetricCrypto.live(parseBetterAuthSecrets("1:domain-limit-test-secret-0123456789")),
  ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));

  /** Stores `limits` as a user's email limits, replacing what was there. */
  const setLimits = Effect.fn(function* (userId: string, limits: unknown) {
    const db = yield* DB;
    // Raw, because the column's type admits only the shape the plans code writes.
    yield* db.execute(
      sql`insert into "user_channel" ("user_id", "channel_type", "limits", "updated_at")
          values (${userId}, 'email', ${JSON.stringify(limits)}::jsonb, now())
          on conflict ("user_id", "channel_type") do update set "limits" = excluded."limits"`,
    );
  });

  /** A user whose Plan allows `customDomains` Domains. */
  const insertBillingUser = Effect.fn(function* (customDomains: number | null) {
    const db = yield* DB;
    const id = `user_limit_${Bun.randomUUIDv7()}`;
    yield* db.insert(user).values({ email: `${id}@example.test`, id, name: "Billing" });
    yield* setLimits(id, {
      customDomains,
      marketing: UNCAPPED_SENDS,
      transactional: UNCAPPED_SENDS,
    });
    return id;
  });

  const insertProject = Effect.fn(function* (billingUserId: string | null) {
    const db = yield* DB;
    const id = typeid("orgn").toString();
    yield* db
      .insert(organization)
      .values({ billingUserId, id, name: "Limits", slug: `limits-${id}` });
    return id;
  });

  const fqdn = () => `${Bun.randomUUIDv7()}.example.test`;

  const add = (organizationId: string, name = fqdn()) =>
    createCustomDomain({ fqdn: name, organizationId });

  /** The FQDNs each of `organizationIds` is linked to, held or claimed. */
  const linked = Effect.fn(function* (...organizationIds: readonly string[]) {
    const db = yield* DB;
    const links = yield* db.query.organizationDomain.findMany({
      where: { organizationId: { in: [...organizationIds] } },
      with: { customDomain: { columns: { fqdn: true } } },
    });
    return links.map((link) => link.customDomain?.fqdn).toSorted();
  });

  const domainNamed = Effect.fn(function* (name: string) {
    const db = yield* DB;
    return yield* db.query.customDomain.findFirst({ where: { fqdn: name } });
  });

  const reached = (limit: number, held: number) => ({
    _tag: "DomainLimitReached",
    held,
    limit,
  });

  it.live("accepts a Domain within the limit and refuses one more than the Plan allows", () =>
    Effect.gen(function* () {
      const projectId = yield* insertProject(yield* insertBillingUser(2));
      const [first, second, third] = [fqdn(), fqdn(), fqdn()];

      expect((yield* add(projectId, first)).kind).toBe("created");
      expect((yield* add(projectId, second)).kind).toBe("created");
      expect(yield* Effect.flip(add(projectId, third))).toMatchObject(reached(2, 2));

      // The refused add left nothing behind: no link, no Domain a later claim would meet.
      expect(yield* linked(projectId)).toEqual([first, second].toSorted());
      expect(yield* domainNamed(third)).toBeUndefined();
    }).pipe(Effect.provide(live)),
  );

  it.live("a null limit allows any number of Domains", () =>
    Effect.gen(function* () {
      const projectId = yield* insertProject(yield* insertBillingUser(null));
      for (let added = 0; added < 3; added += 1) {
        expect((yield* add(projectId)).kind).toBe("created");
      }
    }).pipe(Effect.provide(live)),
  );

  it.live("a limit of zero refuses the first Domain", () =>
    Effect.gen(function* () {
      const projectId = yield* insertProject(yield* insertBillingUser(0));
      expect(yield* Effect.flip(add(projectId))).toMatchObject(reached(0, 0));
    }).pipe(Effect.provide(live)),
  );

  it.live("counts across every Project of the Billing User, and no one else's", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const billingUserId = yield* insertBillingUser(2);
      const first = yield* insertProject(billingUserId);
      // Billed to its owner: a Project with no Billing User of its own.
      const ownedOnly = yield* insertProject(null);
      yield* db
        .insert(member)
        .values({ organizationId: ownedOnly, role: "owner", userId: billingUserId });
      const third = yield* insertProject(billingUserId);
      const someoneElses = yield* insertProject(yield* insertBillingUser(1));

      yield* add(first);
      yield* add(ownedOnly);
      expect(yield* Effect.flip(add(third))).toMatchObject(reached(2, 2));
      expect(yield* Effect.flip(add(ownedOnly))).toMatchObject(reached(2, 2));
      // Another Billing User's Plan is their own.
      expect((yield* add(someoneElses)).kind).toBe("created");
    }).pipe(Effect.provide(live)),
  );

  it.live("a claim counts from the moment it is made, and is refused at the limit", () =>
    Effect.gen(function* () {
      const holderId = yield* insertProject(yield* insertBillingUser(null));
      const [held, alsoHeld] = [fqdn(), fqdn()];
      yield* add(holderId, held);
      yield* add(holderId, alsoHeld);

      const claimantId = yield* insertProject(yield* insertBillingUser(1));
      expect((yield* add(claimantId, held)).kind).toBe("claim");
      // The unproven claim is the one Domain the Plan allows: neither another claim nor a
      // Domain of its own fits beside it.
      expect(yield* Effect.flip(add(claimantId, alsoHeld))).toMatchObject(reached(1, 1));
      expect(yield* Effect.flip(add(claimantId))).toMatchObject(reached(1, 1));
      expect(yield* linked(claimantId)).toEqual([held]);

      // Giving the claim up frees the place it took.
      const claimed = yield* domainNamed(held);
      yield* deleteCustomDomain({ customDomainId: claimed?.id ?? "", organizationId: claimantId });
      expect((yield* add(claimantId)).kind).toBe("created");
    }).pipe(Effect.provide(live)),
  );

  it.live("a Domain is counted once however many of the Billing User's Projects link it", () =>
    Effect.gen(function* () {
      const billingUserId = yield* insertBillingUser(1);
      const holderId = yield* insertProject(billingUserId);
      const siblingId = yield* insertProject(billingUserId);
      const name = fqdn();
      yield* add(holderId, name);

      // At the limit, a sibling Project's claim on the same Domain adds no Domain.
      expect((yield* add(siblingId, name)).kind).toBe("claim");
      expect(yield* Effect.flip(add(siblingId))).toMatchObject(reached(1, 1));
    }).pipe(Effect.provide(live)),
  );

  it.live("adding a Domain the Project already holds is never refused", () =>
    Effect.gen(function* () {
      const projectId = yield* insertProject(yield* insertBillingUser(1));
      const name = fqdn();
      const { customDomainId } = yield* add(projectId, name);

      expect(yield* add(projectId, name)).toEqual({ customDomainId, kind: "existing" });
    }).pipe(Effect.provide(live)),
  );

  it.live("a Billing User over the limit keeps every Domain; only a further add is refused", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const billingUserId = yield* insertBillingUser(null);
      const projectId = yield* insertProject(billingUserId);
      const [first, second] = [fqdn(), fqdn()];
      const { customDomainId } = yield* add(projectId, first);
      yield* add(projectId, second);

      // A claim made while the Plan allowed it, on a Domain another Billing User holds.
      const holderId = yield* insertProject(yield* insertBillingUser(null));
      const claimedName = fqdn();
      const claimed = yield* add(holderId, claimedName);
      expect((yield* add(projectId, claimedName)).kind).toBe("claim");

      // The Plan is downgraded under them, as a subscription ending does.
      yield* setLimits(billingUserId, {
        customDomains: 1,
        marketing: UNCAPPED_SENDS,
        transactional: UNCAPPED_SENDS,
      });

      expect(yield* Effect.flip(add(projectId))).toMatchObject(reached(1, 3));
      expect(yield* add(projectId, first)).toEqual({ customDomainId, kind: "existing" });
      // Proving the earlier claim is not an add: it still takes the Domain.
      expect(
        yield* completeDomainClaimTransfer({
          customDomainId: claimed.customDomainId,
          db,
          organizationId: projectId,
          proof: { ownershipEverVerifiedAt: new Date() },
        }),
      ).toBe(true);
      expect(yield* linked(projectId)).toEqual([first, second, claimedName].toSorted());

      // Back under the limit only once enough are removed.
      yield* deleteCustomDomain({ customDomainId, organizationId: projectId });
      expect(yield* Effect.flip(add(projectId))).toMatchObject(reached(1, 2));
    }).pipe(Effect.provide(live)),
  );

  it.live("of adds racing at the limit, in one Project or across two, exactly one passes", () =>
    Effect.gen(function* () {
      const billingUserId = yield* insertBillingUser(1);
      const first = yield* insertProject(billingUserId);
      const second = yield* insertProject(billingUserId);

      const results = yield* Effect.all(
        [first, first, second, second].map((projectId) => Effect.result(add(projectId))),
        { concurrency: "unbounded" },
      );

      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
      for (const result of results) {
        if (result._tag === "Failure") {
          expect(result.failure).toMatchObject(reached(1, 1));
        }
      }
      expect(yield* linked(first, second)).toHaveLength(1);
    }).pipe(Effect.provide(live)),
  );

  it.live("a Project with no Billing User, or one with no email limits, is refused", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const unowned = yield* insertProject(null);
      const [first, second] = [fqdn(), fqdn()];
      expect(yield* Effect.flip(add(unowned, first))).toMatchObject({
        _tag: "DomainLimitUnreadable",
        code: "billing_user_not_found",
      });

      const userId = `user_limit_${Bun.randomUUIDv7()}`;
      yield* db.insert(user).values({ email: `${userId}@example.test`, id: userId, name: "None" });
      const unlimited = yield* insertProject(userId);
      expect(yield* Effect.flip(add(unlimited, second))).toMatchObject({
        _tag: "DomainLimitUnreadable",
        code: "channel_limits_not_found",
      });

      expect(yield* linked(unowned, unlimited)).toEqual([]);
      expect(yield* domainNamed(first)).toBeUndefined();
      expect(yield* domainNamed(second)).toBeUndefined();
    }).pipe(Effect.provide(live)),
  );

  it.live.each([
    ["no customDomains key", { marketing: UNCAPPED_SENDS, transactional: UNCAPPED_SENDS }],
    ["a negative limit", { customDomains: -1 }],
    ["a fractional limit", { customDomains: 1.5 }],
    ["a limit that is a string", { customDomains: "1" }],
    ["a limit that is a boolean", { customDomains: false }],
    ["the limit one level down", { email: { customDomains: 1 } }],
    ["an array", [1]],
    ["a JSON null", null],
  ])("a limits row with %s refuses the add instead of allowing it", ([, limits]) =>
    Effect.gen(function* () {
      const billingUserId = yield* insertBillingUser(1);
      yield* setLimits(billingUserId, limits);
      const projectId = yield* insertProject(billingUserId);
      const name = fqdn();

      expect(yield* Effect.flip(add(projectId, name))).toMatchObject({
        _tag: "DomainLimitUnreadable",
        code: "channel_limits_invalid",
      });
      expect(yield* domainNamed(name)).toBeUndefined();

      // A claim is read as strictly as an add.
      const holderId = yield* insertProject(yield* insertBillingUser(null));
      const held = fqdn();
      yield* add(holderId, held);
      expect(yield* Effect.flip(add(projectId, held))).toMatchObject({
        _tag: "DomainLimitUnreadable",
        code: "channel_limits_invalid",
      });
      expect(yield* linked(projectId)).toEqual([]);
    }).pipe(Effect.provide(live)),
  );
});
