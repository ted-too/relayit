/**
 * Which user is a Project's Billing User, against a real Postgres, and that Usage and the
 * Plan's Domain limit read the same one.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { member, organization, user, userChannel } from "@repo/persistence/db/schema";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { billingUserOf } from "./billing-user";
import { requireDomainAllowance } from "./email/custom-domain/plan-limit";
import { UsagePolicy, UsagePolicyLive } from "./usage-policy";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const NO_LIMITS = { dailySends: null, monthlySends: null };

describe("a Project's Billing User (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Billing User tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("is the same user for every reader", () => undefined);
    return;
  }

  const live = UsagePolicyLive.pipe(
    Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })),
  );

  const insertUser = Effect.fn(function* () {
    const db = yield* DB;
    const id = typeid("user").toString();
    yield* db.insert(user).values({ email: `${id}@example.test`, id, name: "Member" });
    yield* db.insert(userChannel).values({
      channelType: "email",
      limits: { customDomains: 0, marketing: NO_LIMITS, transactional: NO_LIMITS },
      userId: id,
    });
    return id;
  });

  const insertProject = Effect.fn(function* (billingUserId: string | null) {
    const db = yield* DB;
    const id = typeid("orgn").toString();
    yield* db
      .insert(organization)
      .values({ billingUserId, id, name: "Billing", slug: `billing-${id}` });
    return id;
  });

  const insertOwner = Effect.fn(function* (
    organizationId: string,
    userId: string,
    joined: { readonly createdAt: Date; readonly id?: string },
  ) {
    const db = yield* DB;
    yield* db.insert(member).values({ ...joined, organizationId, role: "owner", userId });
  });

  /**
   * The Billing User each reader names for `organizationId`. The Domain limit names its own
   * only in a refusal, so every user here is on a Plan that allows no Domain.
   */
  const readers = Effect.fn(function* (organizationId: string) {
    const db = yield* DB;
    const policies = yield* UsagePolicy;
    const usage = yield* policies.resolve({
      channel: "email",
      organizationId,
      purpose: "transactional",
      reservedAt: new Date().toISOString(),
    });
    const refusal = yield* db
      .transaction((tx) => requireDomainAllowance(tx, { organizationId }))
      .pipe(Effect.flip);
    return {
      domainLimit: refusal._tag === "DomainLimitReached" ? refusal.billingUserId : refusal,
      resolver: yield* billingUserOf(db, organizationId),
      usage: usage.billingUserId,
    };
  });

  const everyReader = (userId: string) => ({
    domainLimit: userId,
    resolver: userId,
    usage: userId,
  });

  it.live("is the one recorded on the Project, whoever owns it", () =>
    Effect.gen(function* () {
      const [recorded, owner] = [yield* insertUser(), yield* insertUser()];
      const projectId = yield* insertProject(recorded);
      yield* insertOwner(projectId, owner, { createdAt: new Date("2026-01-01T00:00:00Z") });

      expect(yield* readers(projectId)).toEqual(everyReader(recorded));
    }).pipe(Effect.provide(live)),
  );

  // #121. With none recorded and several owners, each reader used to take whichever owner
  // its own query met first. Both orders of insertion, so the answer cannot be the order
  // the rows lie in.
  it.live.each([["first"], ["last"]] as const)(
    "with none recorded, is for every reader the owner who has been a member longest, inserted %s",
    ([inserted]) =>
      Effect.gen(function* () {
        const [longest, newer] = [yield* insertUser(), yield* insertUser()];
        const projectId = yield* insertProject(null);
        const owners = [
          [longest, { createdAt: new Date("2026-01-01T00:00:00Z") }],
          [newer, { createdAt: new Date("2026-02-01T00:00:00Z") }],
        ] as const;
        for (const [userId, joined] of inserted === "first" ? owners : owners.toReversed()) {
          yield* insertOwner(projectId, userId, joined);
        }

        for (let read = 0; read < 3; read += 1) {
          expect(yield* readers(projectId)).toEqual(everyReader(longest));
        }
      }).pipe(Effect.provide(live)),
  );

  it.live("between owners who joined at the same instant, is the one with the lower id", () =>
    Effect.gen(function* () {
      const [lower, higher] = [yield* insertUser(), yield* insertUser()];
      const projectId = yield* insertProject(null);
      const createdAt = new Date("2026-01-01T00:00:00Z");
      yield* insertOwner(projectId, higher, { createdAt, id: `memb_z_${projectId}` });
      yield* insertOwner(projectId, lower, { createdAt, id: `memb_a_${projectId}` });

      expect(yield* readers(projectId)).toEqual(everyReader(lower));
    }).pipe(Effect.provide(live)),
  );

  it.live("is null for a Project with none recorded and no owner, or that does not exist", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      expect(yield* billingUserOf(db, yield* insertProject(null))).toBeNull();
      expect(yield* billingUserOf(db, typeid("orgn").toString())).toBeNull();
    }).pipe(Effect.provide(live)),
  );
});
