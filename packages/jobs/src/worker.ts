import { makeSchemaJsonCodec, Redis } from "@repo/redis";
import type { StreamReadEntry } from "@repo/redis/stream";
import { Clock, Duration, Effect, Schedule } from "effect";
import { type DeadLetterFailure, DeadLetterStore } from "./dead-letter";
import { JobProcessingError, JobWorkerRuntimeError } from "./errors";
import type { JobDispatch, JobHandler, JobRetryPolicy, JobSchema } from "./job";
import { type OutboxPublisherOptions, publishOutboxBatch } from "./outbox";
import {
  JOB_WORKER_GROUP,
  jobEnvelopeSchema,
  jobKeys,
  PROMOTE_DELAYED_JOBS_SCRIPT,
  PROMOTE_SCHEDULED_JOBS_SCRIPT,
  REDIS_PAYLOAD_FIELD,
} from "./storage";

const jobEnvelopeCodec = makeSchemaJsonCodec(jobEnvelopeSchema);

const retryDelay = (
  attempt: number,
  backoff: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  }
) => Math.min(backoff.baseDelayMs * 2 ** (attempt - 1), backoff.maxDelayMs);

const SAFE_FAILURE_CONTEXT = [
  "filename",
  "providerId",
  "reason",
  "retryAfterMs",
  "typeId",
] as const;

const describeFailure = (failure: unknown): DeadLetterFailure => {
  const record =
    typeof failure === "object" && failure !== null
      ? (failure as Readonly<Record<string, unknown>>)
      : undefined;
  const taggedName = typeof record?._tag === "string" ? record._tag : undefined;
  const name =
    taggedName ?? (failure instanceof Error ? failure.name : "JobFailure");
  const message =
    failure instanceof Error && failure.message
      ? failure.message
      : typeof record?.message === "string"
        ? record.message
        : name;
  const code = typeof record?.code === "string" ? record.code : undefined;
  const context = Object.fromEntries(
    SAFE_FAILURE_CONTEXT.flatMap((key) =>
      record?.[key] === undefined ? [] : [[key, record[key]]]
    )
  );

  return {
    ...(code === undefined ? {} : { code }),
    ...(Object.keys(context).length === 0 ? {} : { details: context }),
    message,
    name,
  };
};

const readField = (fields: readonly string[], name: string) => {
  for (const [index, value] of fields.entries()) {
    if (index % 2 === 0 && value === name) {
      return fields[index + 1];
    }
  }

  return;
};

export interface JobBatchOptions {
  readonly blockMs: number;
  readonly concurrency: number;
  readonly consumer: string;
  readonly count: number;
}

export interface JobWorkerOptions extends JobBatchOptions {
  readonly outbox?: OutboxPublisherOptions & {
    readonly intervalMs: number;
  };
  readonly promotion: DelayedPromotionOptions & {
    readonly intervalMs: number;
  };
  readonly reclaim: {
    readonly count: number;
    readonly intervalMs: number;
    readonly minIdleMs: number;
  };
  readonly restart: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
}

export interface DelayedPromotionOptions {
  readonly limit: number;
}

export interface StaleReclaimOptions {
  readonly concurrency: number;
  readonly consumer: string;
  readonly count: number;
  readonly minIdleMs: number;
}

const DEFAULT_OUTBOX_OPTIONS = {
  batchSize: 100,
  claimTtlMs: 30_000,
  concurrency: 10,
  intervalMs: 1000,
} satisfies NonNullable<JobWorkerOptions["outbox"]>;

/**
 * Covariant in Failure / Requirements so a mixed handler list widens to the
 * union of each registration’s channels (no caller-side casts).
 */
export interface JobRegistration<
  out Failure = unknown,
  out Requirements = unknown,
> {
  readonly delayedStream: string;
  readonly payloadsKey?: string;
  readonly process: (
    entry: StreamReadEntry
  ) => Effect.Effect<void, Failure, Requirements>;
  readonly reconcile?: Effect.Effect<void, Failure, Requirements>;
  readonly scheduledKey?: string;
  readonly stream: string;
}

type JobRegistrations = readonly [
  JobRegistration<unknown, unknown>,
  ...JobRegistration<unknown, unknown>[],
];

type JobRegistrationFailure<Registration> =
  Registration extends JobRegistration<infer Failure, infer _Requirements>
    ? Failure
    : never;

type JobRegistrationRequirements<Registration> =
  Registration extends JobRegistration<infer _Failure, infer Requirements>
    ? Requirements
    : never;

export const processJob = <
  Contract extends {
    readonly dispatch: JobDispatch;
    readonly name: string;
    readonly payload: JobSchema;
    readonly recurrence?: {
      readonly identity: (payload: never) => string;
    };
    readonly retry: JobRetryPolicy;
  },
  Failure,
  Requirements,
  DeadLetterFailure,
>(
  handler: JobHandler<Contract, Failure, Requirements, DeadLetterFailure>,
  entry: {
    readonly fields: readonly string[];
    readonly id: string;
  }
): Effect.Effect<
  void,
  Failure | JobProcessingError,
  Requirements | Redis | DeadLetterStore
> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const encoded = readField(entry.fields, REDIS_PAYLOAD_FIELD) ?? "";
    const keys = jobKeys(handler.contract.name);
    const processingError =
      (
        stage:
          | "acknowledge"
          | "dead-letter"
          | "dead-letter-cleanup"
          | "encode-retry"
          | "schedule-retry"
      ) =>
      (cause: unknown) =>
        new JobProcessingError({
          cause,
          entryId: entry.id,
          jobName: handler.contract.name,
          stage,
        });
    const decodedEnvelope = yield* jobEnvelopeCodec.decode(encoded).pipe(
      Effect.map((envelope) => ({ _tag: "Success", envelope }) as const),
      Effect.orElseSucceed(() => ({ _tag: "Failure" }) as const)
    );

    if (decodedEnvelope._tag === "Failure") {
      const deadLetters = yield* DeadLetterStore;
      const failedAt = yield* Clock.currentTimeMillis;
      yield* deadLetters
        .record({
          attempts: 1,
          failedAt,
          failure: {
            code: "JOB_ENVELOPE_INVALID",
            message: "Job envelope could not be decoded",
            name: "JobDecodeFailure",
          },
          firstEnqueuedAt: failedAt,
          jobName: handler.contract.name,
          originalStreamId: entry.id,
          payload: encoded,
          wireVersion: 0,
        })
        .pipe(Effect.mapError(processingError("dead-letter")));
      yield* redis
        .acknowledge({
          group: keys.workers,
          id: entry.id,
          stream: keys.ready,
        })
        .pipe(Effect.mapError(processingError("acknowledge")));
      return;
    }

    const envelope = decodedEnvelope.envelope;
    const decodedPayload = yield* makeSchemaJsonCodec(handler.contract.payload)
      .decode(envelope.data)
      .pipe(
        Effect.map((payload) => ({ _tag: "Success", payload }) as const),
        Effect.orElseSucceed(() => ({ _tag: "Failure" }) as const)
      );
    if (decodedPayload._tag === "Failure") {
      const deadLetters = yield* DeadLetterStore;
      const failedAt = yield* Clock.currentTimeMillis;
      yield* deadLetters
        .record({
          attempts: envelope.attempts + 1,
          failedAt,
          failure: {
            code: "JOB_PAYLOAD_INVALID",
            message: "Job payload could not be decoded",
            name: "JobDecodeFailure",
          },
          firstEnqueuedAt: envelope.firstEnqueuedAt,
          jobName: handler.contract.name,
          originalStreamId: entry.id,
          payload: envelope.data,
          wireVersion: envelope.wireVersion,
        })
        .pipe(Effect.mapError(processingError("dead-letter")));
      yield* redis
        .acknowledge({
          group: keys.workers,
          id: entry.id,
          stream: keys.ready,
        })
        .pipe(Effect.mapError(processingError("acknowledge")));
      return;
    }

    const attempt = envelope.attempts + 1;
    const execution = {
      attempt,
      enqueuedAt: envelope.firstEnqueuedAt,
      id: entry.id,
    };
    const outcome = yield* handler
      .handle(decodedPayload.payload, execution)
      .pipe(
        Effect.match({
          onFailure: (error) => ({ _tag: "Failure", error }) as const,
          onSuccess: () => ({ _tag: "Success" }) as const,
        })
      );

    if (outcome._tag === "Failure") {
      const disposition = handler.classifyFailure(outcome.error);

      if (
        disposition === "retryable" &&
        attempt < handler.contract.retry.maxAttempts
      ) {
        const now = yield* Clock.currentTimeMillis;
        const retry = yield* jobEnvelopeCodec
          .encode({
            ...envelope,
            attempts: attempt,
          })
          .pipe(Effect.mapError(processingError("encode-retry")));
        yield* redis
          .sortedSetAdd({
            key: keys.delayed,
            member: retry,
            score: now + retryDelay(attempt, handler.contract.retry.backoff),
          })
          .pipe(Effect.mapError(processingError("schedule-retry")));
      } else {
        if (handler.onDeadLetter) {
          yield* handler
            .onDeadLetter(decodedPayload.payload, execution, outcome.error)
            .pipe(Effect.mapError(processingError("dead-letter-cleanup")));
        }
        const deadLetters = yield* DeadLetterStore;
        const failedAt = yield* Clock.currentTimeMillis;
        yield* deadLetters
          .record({
            attempts: attempt,
            failedAt,
            failure: describeFailure(outcome.error),
            firstEnqueuedAt: envelope.firstEnqueuedAt,
            jobName: handler.contract.name,
            originalStreamId: entry.id,
            payload: envelope.data,
            wireVersion: envelope.wireVersion,
          })
          .pipe(Effect.mapError(processingError("dead-letter")));
      }
    }

    yield* redis
      .acknowledge({
        group: keys.workers,
        id: entry.id,
        stream: keys.ready,
      })
      .pipe(Effect.mapError(processingError("acknowledge")));
  }) as Effect.Effect<
    void,
    Failure | JobProcessingError,
    Requirements | Redis | DeadLetterStore
  >;

export const registerJobHandler = <
  Contract extends {
    readonly dispatch: JobDispatch;
    readonly name: string;
    readonly payload: JobSchema;
    readonly recurrence?: {
      readonly identity: (payload: never) => string;
    };
    readonly retry: JobRetryPolicy;
  },
  Failure,
  Requirements,
  DeadLetterFailure,
>(
  handler: JobHandler<Contract, Failure, Requirements, DeadLetterFailure>
) => {
  const keys = jobKeys(handler.contract.name);
  const recurring = handler.contract.recurrence !== undefined;

  return {
    delayedStream: keys.delayed,
    ...(recurring
      ? {
          payloadsKey: keys.payloads,
          scheduledKey: keys.scheduled,
        }
      : {}),
    process: (entry: StreamReadEntry) => processJob(handler, entry),
    reconcile: handler.reconcile,
    stream: keys.ready,
  };
};

export const promoteDelayedJobs = <T extends JobRegistrations>(
  registrations: [...T],
  options: DelayedPromotionOptions
) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const now = yield* Clock.currentTimeMillis;

    yield* Effect.forEach(
      registrations,
      ({ delayedStream, stream }) =>
        redis
          .evaluateNumber({
            args: [String(now), String(options.limit)],
            keys: [delayedStream, stream],
            script: PROMOTE_DELAYED_JOBS_SCRIPT,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JobWorkerRuntimeError({
                  cause,
                  stage: "promote",
                  stream,
                })
            )
          ),
      { concurrency: "unbounded" }
    );
  });

export const promoteScheduledJobs = <T extends JobRegistrations>(
  registrations: [...T],
  options: DelayedPromotionOptions
) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const now = yield* Clock.currentTimeMillis;
    const recurring = registrations.filter(
      (
        registration
      ): registration is T[number] & {
        readonly payloadsKey: string;
        readonly scheduledKey: string;
      } =>
        registration.scheduledKey !== undefined &&
        registration.payloadsKey !== undefined
    );

    yield* Effect.forEach(
      recurring,
      ({ payloadsKey, scheduledKey, stream }) =>
        redis
          .evaluateNumber({
            args: [String(now), String(options.limit)],
            keys: [scheduledKey, payloadsKey, stream],
            script: PROMOTE_SCHEDULED_JOBS_SCRIPT,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JobWorkerRuntimeError({
                  cause,
                  stage: "promote",
                  stream,
                })
            )
          ),
      { concurrency: "unbounded" }
    );
  });

export const reclaimStaleJobs = <T extends JobRegistrations>(
  registrations: [...T],
  options: StaleReclaimOptions
): Effect.Effect<
  void,
  JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
  JobRegistrationRequirements<T[number]> | Redis
> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const group = JOB_WORKER_GROUP;

    const reclaim = (
      registration: T[number],
      start: string
    ): Effect.Effect<
      void,
      JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
      JobRegistrationRequirements<T[number]> | Redis
    > =>
      redis
        .autoClaim({
          consumer: options.consumer,
          count: options.count,
          group,
          minIdleMs: options.minIdleMs,
          start,
          stream: registration.stream,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new JobWorkerRuntimeError({
                cause,
                stage: "reclaim",
                stream: registration.stream,
              })
          ),
          Effect.flatMap(({ entries, nextStart }) =>
            Effect.forEach(
              entries,
              (entry) =>
                registration.process({
                  ...entry,
                  stream: registration.stream,
                }),
              { concurrency: options.concurrency }
            ).pipe(
              Effect.flatMap(() => {
                if (nextStart === "0-0") {
                  return Effect.void;
                }
                if (nextStart === start) {
                  return Effect.die(
                    new Error(
                      `Redis auto-claim cursor did not advance for ${registration.stream}`
                    )
                  );
                }
                return reclaim(registration, nextStart);
              })
            )
          )
        ) as Effect.Effect<
        void,
        JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
        JobRegistrationRequirements<T[number]> | Redis
      >;

    yield* Effect.forEach(
      registrations,
      (registration) => reclaim(registration, "0-0"),
      { concurrency: "unbounded" }
    );
  }) as Effect.Effect<
    void,
    JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
    JobRegistrationRequirements<T[number]> | Redis
  >;

export const processJobBatch = <T extends JobRegistrations>(
  registrations: [...T],
  options: JobBatchOptions
): Effect.Effect<
  void,
  JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
  JobRegistrationRequirements<T[number]> | Redis
> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const byStream = new Map(
      registrations.map((registration) => [registration.stream, registration])
    );
    const entries = yield* redis
      .readGroup({
        blockMs: options.blockMs,
        consumer: options.consumer,
        count: options.count,
        group: JOB_WORKER_GROUP,
        streams: registrations.map(({ stream }) => stream),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new JobWorkerRuntimeError({
              cause,
              stage: "consume",
            })
        )
      );

    yield* Effect.forEach(
      entries,
      (entry) => {
        const registration = byStream.get(entry.stream);
        return registration
          ? registration.process(entry)
          : Effect.die(
              new Error(`No job handler registered for ${entry.stream}`)
            );
      },
      { concurrency: options.concurrency }
    );
  }) as Effect.Effect<
    void,
    JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
    JobRegistrationRequirements<T[number]> | Redis
  >;

export const runJobWorker = <T extends JobRegistrations>(
  registrations: [...T],
  options: JobWorkerOptions
): Effect.Effect<
  void,
  JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
  DeadLetterStore | JobRegistrationRequirements<T[number]> | Redis
> => {
  const run = Effect.gen(function* () {
    const redis = yield* Redis;
    const group = JOB_WORKER_GROUP;
    const outboxOptions = options.outbox ?? DEFAULT_OUTBOX_OPTIONS;

    yield* Effect.forEach(
      registrations,
      ({ stream }) =>
        redis.createConsumerGroup({ group, stream }).pipe(
          Effect.mapError(
            (cause) =>
              new JobWorkerRuntimeError({
                cause,
                stage: "create-group",
                stream,
              })
          )
        ),
      { concurrency: "unbounded" }
    );

    yield* Effect.forEach(
      registrations,
      (registration) =>
        (registration.reconcile ?? Effect.void).pipe(
          Effect.mapError(
            (cause) =>
              new JobWorkerRuntimeError({
                cause,
                stage: "reconcile",
                stream: registration.stream,
              })
          )
        ),
      { concurrency: "unbounded" }
    );

    return yield* Effect.all(
      [
        processJobBatch(registrations, options).pipe(Effect.forever),
        promoteDelayedJobs(registrations, options.promotion).pipe(
          Effect.andThen(Effect.sleep(options.promotion.intervalMs)),
          Effect.forever
        ),
        promoteScheduledJobs(registrations, options.promotion).pipe(
          Effect.andThen(Effect.sleep(options.promotion.intervalMs)),
          Effect.forever
        ),
        reclaimStaleJobs(registrations, {
          concurrency: options.concurrency,
          consumer: options.consumer,
          count: options.reclaim.count,
          minIdleMs: options.reclaim.minIdleMs,
        }).pipe(
          Effect.andThen(Effect.sleep(options.reclaim.intervalMs)),
          Effect.forever
        ),
        publishOutboxBatch(outboxOptions).pipe(
          Effect.andThen(Effect.sleep(outboxOptions.intervalMs)),
          Effect.forever
        ),
      ],
      { concurrency: "unbounded", discard: true }
    );
  });

  const restartSchedule = Schedule.exponential(
    Duration.millis(options.restart.baseDelayMs)
  ).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(
        Duration.min(duration, Duration.millis(options.restart.maxDelayMs))
      )
    )
  );

  return run.pipe(
    Effect.tapError((error) =>
      Effect.logError("Job worker failed; restarting", error)
    ),
    Effect.retry(restartSchedule)
  ) as Effect.Effect<
    void,
    JobRegistrationFailure<T[number]> | JobWorkerRuntimeError,
    DeadLetterStore | JobRegistrationRequirements<T[number]> | Redis
  >;
};
