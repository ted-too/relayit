import { DB } from "@repo/persistence/db/effect";
import { Redis } from "@repo/redis";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Clock, DateTime, Effect } from "effect";
import { typeid } from "typeid-js";
import { JobWorkerRuntimeError } from "./errors";
import { jobOutbox } from "./outbox-schema";
import { jobKeys, REDIS_PAYLOAD_FIELD } from "./storage";

export interface OutboxPublisherOptions {
  readonly batchSize: number;
  readonly claimTtlMs: number;
  readonly concurrency: number;
}

type ClaimedJob = typeof jobOutbox.$inferSelect & {
  readonly claimToken: string;
};

const dateFromMillis = (millis: number) =>
  DateTime.toDate(DateTime.makeUnsafe(millis));

const outboxError =
  (stage: "outbox-claim" | "outbox-publish", stream?: string) =>
  (cause: unknown) =>
    new JobWorkerRuntimeError({
      cause,
      stage,
      stream,
    });

const claimOutboxJobs = (options: OutboxPublisherOptions) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const nowMillis = yield* Clock.currentTimeMillis;
    const now = dateFromMillis(nowMillis);
    const claimToken = typeid("joc").toString();
    const claimExpiresAt = dateFromMillis(nowMillis + options.claimTtlMs);

    return yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          const available = yield* transaction
            .select()
            .from(jobOutbox)
            .where(
              and(
                eq(jobOutbox.status, "pending"),
                or(
                  isNull(jobOutbox.claimExpiresAt),
                  lt(jobOutbox.claimExpiresAt, now)
                )
              )
            )
            .orderBy(asc(jobOutbox.createdAt))
            .limit(options.batchSize)
            .for("update", { skipLocked: true });

          if (available.length === 0) {
            return [] as readonly ClaimedJob[];
          }

          const ids = available.map(({ id }) => id);
          yield* transaction
            .update(jobOutbox)
            .set({
              claimExpiresAt,
              claimToken,
              updatedAt: now,
            })
            .where(inArray(jobOutbox.id, ids));

          return available.map((record) => ({
            ...record,
            claimExpiresAt,
            claimToken,
          }));
        })
      )
      .pipe(Effect.mapError(outboxError("outbox-claim")));
  });

const releaseClaim = (job: ClaimedJob, cause: unknown) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const now = dateFromMillis(yield* Clock.currentTimeMillis);

    yield* db
      .update(jobOutbox)
      .set({
        attempts: job.attempts + 1,
        claimExpiresAt: null,
        claimToken: null,
        lastError: cause instanceof Error ? cause.message : String(cause),
        updatedAt: now,
      })
      .where(
        and(eq(jobOutbox.id, job.id), eq(jobOutbox.claimToken, job.claimToken))
      );
  }).pipe(
    Effect.mapError(outboxError("outbox-publish", jobKeys(job.jobName).ready))
  );

const markPublished = (job: ClaimedJob) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const now = dateFromMillis(yield* Clock.currentTimeMillis);

    yield* db
      .update(jobOutbox)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        lastError: null,
        publishedAt: now,
        status: "published",
        updatedAt: now,
      })
      .where(
        and(eq(jobOutbox.id, job.id), eq(jobOutbox.claimToken, job.claimToken))
      );
  }).pipe(
    Effect.mapError(outboxError("outbox-publish", jobKeys(job.jobName).ready))
  );

const publishOutboxJob = (job: ClaimedJob) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const keys = jobKeys(job.jobName);
    const publish: Effect.Effect<void, unknown> =
      job.delayUntil === null
        ? redis
            .append({
              fields: { [REDIS_PAYLOAD_FIELD]: job.payload },
              stream: keys.ready,
            })
            .pipe(Effect.asVoid)
        : redis
            .sortedSetAdd({
              key: keys.delayed,
              member: job.payload,
              score: job.delayUntil.getTime(),
            })
            .pipe(Effect.asVoid);

    const result = yield* publish.pipe(
      Effect.match({
        onFailure: (error) => ({ error, success: false }) as const,
        onSuccess: () => ({ success: true }) as const,
      })
    );

    if (!result.success) {
      yield* releaseClaim(job, result.error);
      return;
    }

    yield* markPublished(job);
  });

export const publishOutboxBatch = (options: OutboxPublisherOptions) =>
  claimOutboxJobs(options).pipe(
    Effect.flatMap((jobs) =>
      Effect.forEach(jobs, publishOutboxJob, {
        concurrency: options.concurrency,
        discard: true,
      })
    )
  );
