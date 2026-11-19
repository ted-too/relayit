import { Jobs, JobsLive, type JobsService } from "@repo/jobs";
import { makeRedisLive } from "@repo/redis";
import { Effect, Layer } from "effect";

/**
 * The real queue for an integration test, on Redis keys of its own: every call reaches
 * `JobsLive`, so a transactional job is written to the outbox in the caller's transaction
 * and a recurring one to Redis. It also records what was scheduled and for when, to assert
 * on. Provides `Redis` too, for a test that runs a worker pass.
 */
export const recordedJobs = (redisUrl: string) => {
  const scheduled: { readonly name: string; readonly payload: unknown }[] = [];
  /** When each of `scheduled` is due, in the same order. */
  const scheduledAt: number[] = [];

  const layer = Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const jobs = yield* Jobs;
      return {
        ...jobs,
        // Every job these tests schedule has a payload, so the overload without one is
        // not passed through.
        schedule: ((contract, payload, at) =>
          jobs.schedule(contract, payload, at).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                scheduled.push({ name: contract.name, payload });
                scheduledAt.push(at);
              }),
            ),
          )) as JobsService["schedule"],
      };
    }),
  ).pipe(
    Layer.provide(JobsLive),
    Layer.provideMerge(makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: redisUrl })),
  );

  return { layer, scheduled, scheduledAt };
};
