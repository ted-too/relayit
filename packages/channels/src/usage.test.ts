import { describe, expect, test } from "bun:test";
import { makeRedisLive } from "@repo/redis";
import { Effect, Layer } from "effect";
import {
  Usage,
  UsageLive,
  UsagePolicy,
  type UsagePolicyService,
} from "./usage";

const testRedisUrl = Bun.env.TEST_REDIS_URL;
const integrationTestName = "Usage reservation lifecycle";

const makePolicy = (
  limits: Partial<Record<"managed" | "byo", number>>
): UsagePolicyService => {
  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  return {
    resolve: ({ organizationId, providerKind }) =>
      Effect.succeed({
        billingUserId: `billing_${organizationId}`,
        dailyLimit: limits[providerKind] ?? null,
        monthlyLimit: limits[providerKind] ?? null,
        periodEnd,
        periodStart,
      }),
  };
};

const runWithUsage = <A, E>(
  policy: UsagePolicyService,
  effect: Effect.Effect<A, E, Usage>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        UsageLive.pipe(
          Layer.provide(
            Layer.merge(
              makeRedisLive({ url: testRedisUrl ?? "" }),
              Layer.succeed(UsagePolicy, policy)
            )
          )
        )
      )
    )
  );

const makeReservation = (
  organizationId: string,
  deliveryId: string,
  providerKind: "managed" | "byo" = "managed"
) => ({
  channel: "email" as const,
  deliveryId,
  organizationId,
  providerKind,
  purpose: "transactional" as const,
  reservedAt: new Date().toISOString(),
});

describe("Usage reservation lifecycle", () => {
  if (!testRedisUrl) {
    process.emitWarning(
      "Skipping Usage integration tests: TEST_REDIS_URL is not set"
    );
    // biome-ignore lint/suspicious/noSkippedTests: The Redis test is opt-in.
    test.skip(integrationTestName, () => undefined);
    return;
  }

  test("reserving the same Delivery twice consumes one place", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(
      organizationId,
      `delivery_${Bun.randomUUIDv7()}`
    );
    const second = makeReservation(
      organizationId,
      `delivery_${Bun.randomUUIDv7()}`
    );

    return runWithUsage(
      makePolicy({ managed: 1 }),
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
      })
    );
  });

  test("remetering moves the reservation to the actual Provider kind", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const original = makeReservation(
      organizationId,
      `delivery_${Bun.randomUUIDv7()}`
    );

    return runWithUsage(
      makePolicy({ byo: 1, managed: 1 }),
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.reserve(original);
        yield* usage.remeter({
          deliveryId: original.deliveryId,
          providerKind: "byo",
        });
        yield* usage.remeter({
          deliveryId: original.deliveryId,
          providerKind: "byo",
        });

        yield* usage.reserve(
          makeReservation(
            organizationId,
            `delivery_${Bun.randomUUIDv7()}`,
            "managed"
          )
        );

        const error = yield* usage
          .reserve(
            makeReservation(
              organizationId,
              `delivery_${Bun.randomUUIDv7()}`,
              "byo"
            )
          )
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      })
    );
  });

  test("releasing twice cannot release another Delivery's Usage", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(
      organizationId,
      `delivery_${Bun.randomUUIDv7()}`
    );

    return runWithUsage(
      makePolicy({ managed: 1 }),
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.reserve(first);
        yield* usage.release({ deliveryId: first.deliveryId });

        yield* usage.reserve(
          makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`)
        );
        yield* usage.release({ deliveryId: first.deliveryId });

        const error = yield* usage
          .reserve(
            makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`)
          )
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      })
    );
  });

  test("confirmed Usage remains consumed when cleanup is replayed", () => {
    const organizationId = `organization_${Bun.randomUUIDv7()}`;
    const first = makeReservation(
      organizationId,
      `delivery_${Bun.randomUUIDv7()}`
    );

    return runWithUsage(
      makePolicy({ managed: 1 }),
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.reserve(first);
        yield* usage.confirm({ deliveryId: first.deliveryId });
        yield* usage.release({ deliveryId: first.deliveryId });

        const error = yield* usage
          .reserve(
            makeReservation(organizationId, `delivery_${Bun.randomUUIDv7()}`)
          )
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "UsageLimitExceeded",
          window: "daily",
        });
      })
    );
  });
});
