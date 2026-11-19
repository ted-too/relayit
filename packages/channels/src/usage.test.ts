import { describe, expect, it, test } from "@effect/vitest";
import { makeRedisLive, Redis } from "@repo/redis";
import { Effect, Layer } from "effect";
import { Usage, UsageLive, UsagePolicy, type UsagePolicyService } from "./usage";
import { USAGE_TOMBSTONE_TTL_SECONDS } from "./usage-ledger";

const testRedisUrl = Bun.env.TEST_REDIS_URL;
const integrationTestName = "Usage reservation lifecycle";

const makePolicy = (limit: number | null): UsagePolicyService => {
  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  return {
    resolve: ({ organizationId }) =>
      Effect.succeed({
        billingUserId: `billing_${organizationId}`,
        dailyLimit: limit,
        monthlyLimit: limit,
        periodEnd,
        periodStart,
      }),
  };
};

const withUsage = <A, E>(policy: UsagePolicyService, effect: Effect.Effect<A, E, Redis | Usage>) =>
  effect.pipe(
    Effect.provide(
      UsageLive.pipe(
        Layer.provide(Layer.succeed(UsagePolicy, policy)),
        Layer.provideMerge(makeRedisLive({ url: testRedisUrl ?? "" })),
      ),
    ),
  );

const makeReservation = (organizationId: string, deliveryId: string) => ({
  channel: "email" as const,
  deliveryId,
  organizationId,
  purpose: "transactional" as const,
  reservedAt: new Date().toISOString(),
});

describe("Usage reservation lifecycle", () => {
  if (!testRedisUrl) {
    process.emitWarning("Skipping Usage integration tests: TEST_REDIS_URL is not set");
    // The Redis test is opt-in.
    test.skip(integrationTestName, () => undefined);
    return;
  }

  it.live("reserving the same Delivery twice consumes one place", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`);
    const second = makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`);

    return withUsage(
      makePolicy(1),
      Effect.gen(function* () {
        const usage = yield* Usage;
        const policy = yield* usage.reserve(first);
        expect(policy).toMatchObject({
          billingUserId: `billing_${organizationId}`,
          dailyLimit: 1,
          monthlyLimit: 1,
        });
        expect(yield* usage.reserve(first)).toEqual(policy);
        const error = yield* usage.reserve(second).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      }),
    );
  });

  it.live("releasing twice cannot release another Delivery's Usage", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`);

    return withUsage(
      makePolicy(1),
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.reserve(first);
        yield* usage.release({ deliveryId: first.deliveryId });

        yield* usage.reserve(makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`));
        yield* usage.release({ deliveryId: first.deliveryId });

        const error = yield* usage
          .reserve(makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`))
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      }),
    );
  });

  it.live("confirmed Usage remains consumed when cleanup is replayed", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`);

    return withUsage(
      makePolicy(1),
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.reserve(first);
        yield* usage.confirm({ deliveryId: first.deliveryId });
        yield* usage.release({ deliveryId: first.deliveryId });

        const error = yield* usage
          .reserve(makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`))
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      }),
    );
  });

  it.live("a reservation never confirmed or released expires after its billing period", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const reservation = makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`);

    return withUsage(
      makePolicy(1),
      Effect.gen(function* () {
        const usage = yield* Usage;
        const policy = yield* usage.reserve(reservation);

        const redis = yield* Redis;
        const ttl = yield* redis.evaluateNumber({
          args: [],
          keys: [`relayit:usage:reservation:${reservation.deliveryId}`],
          script: 'return redis.call("TTL", KEYS[1])',
        });
        // Until its period ends only a release gives its place back, so it outlives the
        // period, by the time a finalized one is kept; and it does not stay for good.
        const untilPeriodEnd = Math.floor(
          (policy.periodEnd.getTime() - new Date(reservation.reservedAt).getTime()) / 1000,
        );
        expect(ttl).toBeGreaterThanOrEqual(untilPeriodEnd + USAGE_TOMBSTONE_TTL_SECONDS - 60);
        expect(ttl).toBeLessThanOrEqual(untilPeriodEnd + USAGE_TOMBSTONE_TTL_SECONDS + 60);
      }),
    );
  });
});
