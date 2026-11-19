import { JobEnqueueError, Jobs, JobsLive, type JobsService } from "@repo/jobs";
import { makeRedisLive } from "@repo/redis";
import { Effect, Layer } from "effect";

interface Recorded {
  readonly name: string;
  readonly payload: unknown;
}

/**
 * The real queue for an integration test, on Redis keys of its own: every call reaches
 * `JobsLive`, so a transactional job is written to the outbox in the caller's transaction
 * and a recurring one to Redis. What it adds is a record of the calls that succeeded, to
 * assert on, and a way to make a call fail as Redis or the outbox would. A call that fails
 * is not recorded; one whose transaction later rolls back is.
 */
export const recordedJobs = (
  redisUrl: string,
  options: {
    readonly failCancel?: boolean;
    /** The FQDN in the payload of the enqueue to refuse, if any. */
    readonly failEnqueueFor?: () => string | undefined;
    readonly failSchedule?: () => boolean;
  } = {},
) => {
  const scheduled: Recorded[] = [];
  /** When each of `scheduled` is due, in the same order. */
  const scheduledAt: number[] = [];
  const cancelled: Recorded[] = [];
  const enqueued: Recorded[] = [];
  /** When each of `enqueued` was delayed until, in the same order. */
  const enqueuedFor: (number | undefined)[] = [];

  const layer = Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const jobs = yield* Jobs;
      // The service's methods are overloaded by contract; a test passes each call through
      // as it was made.
      const real = jobs as unknown as Record<
        "cancel" | "enqueue" | "schedule",
        (...args: readonly unknown[]) => Effect.Effect<void, JobEnqueueError>
      >;
      return {
        cancel: ((contract: { readonly name: string }, payload?: unknown) =>
          options.failCancel
            ? Effect.fail(
                new JobEnqueueError({
                  cause: "Redis is down",
                  jobName: contract.name,
                  stage: "cancel",
                }),
              )
            : real
                .cancel(contract, payload)
                .pipe(
                  Effect.tap(() =>
                    Effect.sync(() => cancelled.push({ name: contract.name, payload })),
                  ),
                )) as JobsService["cancel"],
        enqueue: ((
          contract: { readonly name: string },
          payload: { readonly fqdn?: string },
          transaction?: unknown,
          enqueueOptions?: { readonly delayUntil?: number },
        ) =>
          payload.fqdn !== undefined && payload.fqdn === options.failEnqueueFor?.()
            ? Effect.fail(
                new JobEnqueueError({ cause: "refused", jobName: contract.name, stage: "outbox" }),
              )
            : real.enqueue(contract, payload, transaction, enqueueOptions).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    enqueued.push({ name: contract.name, payload });
                    enqueuedFor.push(enqueueOptions?.delayUntil);
                  }),
                ),
              )) as JobsService["enqueue"],
        schedule: ((contract: { readonly name: string }, payload: unknown, at?: number) =>
          options.failSchedule?.()
            ? Effect.fail(
                new JobEnqueueError({
                  cause: "Redis is down",
                  jobName: contract.name,
                  stage: "schedule",
                }),
              )
            : real.schedule(contract, payload, at).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    scheduled.push({ name: contract.name, payload });
                    scheduledAt.push(at ?? Number.NaN);
                  }),
                ),
              )) as JobsService["schedule"],
      };
    }),
  ).pipe(
    Layer.provide(JobsLive),
    Layer.provideMerge(makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: redisUrl })),
  );

  return { cancelled, enqueued, enqueuedFor, layer, scheduled, scheduledAt };
};
