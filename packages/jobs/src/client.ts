import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import { Redis } from "@repo/redis";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import { JobEnqueueError } from "./errors";
import {
  isJobPayloadNone,
  type Job,
  type JobDispatch,
  type JobPayloadNone,
  type JobSchema,
  type RecurringJob,
} from "./job";
import { jobOutbox } from "./outbox-schema";
import {
  CANCEL_RECURRING_JOB_SCRIPT,
  encodeJob,
  jobKeys,
  REDIS_PAYLOAD_FIELD,
  SCHEDULE_RECURRING_JOB_SCRIPT,
} from "./storage";

export interface EnqueueOptions {
  readonly delayUntil?: number;
}

export interface JobsService {
  readonly cancel: {
    <const Name extends string>(
      contract: RecurringJob<Name, JobPayloadNone>
    ): Effect.Effect<void, JobEnqueueError>;
    <const Name extends string, PayloadSchema extends JobSchema>(
      contract: RecurringJob<Name, PayloadSchema>,
      payload: PayloadSchema["Type"]
    ): Effect.Effect<void, JobEnqueueError>;
  };
  readonly enqueue: {
    <const Name extends string>(
      contract: Job<Name, JobPayloadNone, "immediate">,
      options?: EnqueueOptions
    ): Effect.Effect<void, JobEnqueueError>;
    <const Name extends string, PayloadSchema extends JobSchema>(
      contract: Job<Name, PayloadSchema, "immediate">,
      payload: PayloadSchema["Type"],
      options?: EnqueueOptions
    ): Effect.Effect<void, JobEnqueueError>;
    <const Name extends string>(
      contract: Job<Name, JobPayloadNone, "transactional">,
      transaction: DatabaseTransaction,
      options?: EnqueueOptions
    ): Effect.Effect<void, JobEnqueueError>;
    <const Name extends string, PayloadSchema extends JobSchema>(
      contract: Job<Name, PayloadSchema, "transactional">,
      payload: PayloadSchema["Type"],
      transaction: DatabaseTransaction,
      options?: EnqueueOptions
    ): Effect.Effect<void, JobEnqueueError>;
  };
  readonly schedule: {
    <const Name extends string>(
      contract: RecurringJob<Name, JobPayloadNone>,
      runAt: number
    ): Effect.Effect<void, JobEnqueueError>;
    <const Name extends string, PayloadSchema extends JobSchema>(
      contract: RecurringJob<Name, PayloadSchema>,
      payload: PayloadSchema["Type"],
      runAt: number
    ): Effect.Effect<void, JobEnqueueError>;
  };
}

export class Jobs extends Context.Service<Jobs, JobsService>()("Jobs/Client") {}

export const JobsLive = Layer.effect(
  Jobs,
  Effect.gen(function* () {
    const redis = yield* Redis;

    const enqueueImpl = <
      const Name extends string,
      PayloadSchema extends JobSchema,
      Dispatch extends JobDispatch,
    >(
      contract: Job<Name, PayloadSchema, Dispatch>,
      payload: PayloadSchema["Type"],
      transactionOrOptions?: DatabaseTransaction | EnqueueOptions,
      transactionalOptions?: EnqueueOptions
    ) =>
      Effect.gen(function* () {
        const firstEnqueuedAt = yield* Clock.currentTimeMillis;
        const encoded = yield* encodeJob(
          contract,
          payload,
          firstEnqueuedAt
        ).pipe(
          Effect.mapError(
            (cause) =>
              new JobEnqueueError({
                cause,
                jobName: contract.name,
                stage: "encode",
              })
          )
        );

        if (contract.dispatch === "transactional") {
          const transaction = transactionOrOptions as
            | DatabaseTransaction
            | undefined;
          if (!(transaction && "insert" in transaction)) {
            return yield* new JobEnqueueError({
              cause: new Error(
                `Transactional Job ${contract.name} requires a database transaction`
              ),
              jobName: contract.name,
              stage: "outbox",
            });
          }

          yield* transaction
            .insert(jobOutbox)
            .values({
              delayUntil:
                transactionalOptions?.delayUntil === undefined
                  ? null
                  : DateTime.toDate(
                      DateTime.makeUnsafe(transactionalOptions.delayUntil)
                    ),
              jobName: contract.name,
              payload: encoded,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new JobEnqueueError({
                    cause,
                    jobName: contract.name,
                    stage: "outbox",
                  })
              )
            );
          return;
        }

        const options = transactionOrOptions as EnqueueOptions | undefined;
        const keys = jobKeys(contract.name);

        if (options?.delayUntil !== undefined) {
          yield* redis
            .sortedSetAdd({
              key: keys.delayed,
              member: encoded,
              score: options.delayUntil,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new JobEnqueueError({
                    cause,
                    jobName: contract.name,
                    stage: "schedule",
                  })
              )
            );
          return;
        }

        yield* redis
          .append({
            fields: { [REDIS_PAYLOAD_FIELD]: encoded },
            stream: keys.ready,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JobEnqueueError({
                  cause,
                  jobName: contract.name,
                  stage: "append",
                })
            )
          );
      });

    const scheduleImpl = <
      const Name extends string,
      PayloadSchema extends JobSchema,
    >(
      contract: RecurringJob<Name, PayloadSchema>,
      payload: PayloadSchema["Type"],
      runAt: number
    ) =>
      Effect.gen(function* () {
        const firstEnqueuedAt = yield* Clock.currentTimeMillis;
        const encoded = yield* encodeJob(
          contract,
          payload,
          firstEnqueuedAt
        ).pipe(
          Effect.mapError(
            (cause) =>
              new JobEnqueueError({
                cause,
                jobName: contract.name,
                stage: "encode",
              })
          )
        );
        const identity = contract.recurrence.identity(payload);
        const keys = jobKeys(contract.name);
        yield* redis
          .evaluateNumber({
            args: [String(runAt), identity, encoded],
            keys: [keys.scheduled, keys.payloads],
            script: SCHEDULE_RECURRING_JOB_SCRIPT,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JobEnqueueError({
                  cause,
                  jobName: contract.name,
                  stage: "schedule",
                })
            )
          );
      });

    const cancelImpl = <
      const Name extends string,
      PayloadSchema extends JobSchema,
    >(
      contract: RecurringJob<Name, PayloadSchema>,
      payload: PayloadSchema["Type"]
    ) =>
      Effect.gen(function* () {
        const keys = jobKeys(contract.name);
        yield* redis
          .evaluateNumber({
            args: [contract.recurrence.identity(payload)],
            keys: [keys.scheduled, keys.payloads],
            script: CANCEL_RECURRING_JOB_SCRIPT,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JobEnqueueError({
                  cause,
                  jobName: contract.name,
                  stage: "cancel",
                })
            )
          );
      });

    const enqueue = (
      contract: Job<string, JobSchema, JobDispatch>,
      payloadOrTransactionOrOptions?:
        | unknown
        | DatabaseTransaction
        | EnqueueOptions,
      transactionOrOptions?: DatabaseTransaction | EnqueueOptions,
      transactionalOptions?: EnqueueOptions
    ) => {
      if (isJobPayloadNone(contract)) {
        if (
          payloadOrTransactionOrOptions &&
          typeof payloadOrTransactionOrOptions === "object" &&
          "insert" in payloadOrTransactionOrOptions
        ) {
          return enqueueImpl(
            contract,
            null,
            payloadOrTransactionOrOptions as DatabaseTransaction,
            transactionOrOptions as EnqueueOptions | undefined
          );
        }
        return enqueueImpl(
          contract,
          null,
          payloadOrTransactionOrOptions as EnqueueOptions | undefined
        );
      }

      return enqueueImpl(
        contract,
        payloadOrTransactionOrOptions,
        transactionOrOptions,
        transactionalOptions
      );
    };

    const schedule = (
      contract: RecurringJob<string, JobSchema>,
      payloadOrRunAt: unknown,
      maybeRunAt?: number
    ) => {
      if (isJobPayloadNone(contract)) {
        return scheduleImpl(contract, null, payloadOrRunAt as number);
      }
      return scheduleImpl(contract, payloadOrRunAt, maybeRunAt as number);
    };

    const cancel = (
      contract: RecurringJob<string, JobSchema>,
      payload?: unknown
    ) => {
      if (isJobPayloadNone(contract)) {
        return cancelImpl(contract, null);
      }
      return cancelImpl(contract, payload);
    };

    return {
      cancel: cancel as JobsService["cancel"],
      enqueue: enqueue as JobsService["enqueue"],
      schedule: schedule as JobsService["schedule"],
    } satisfies JobsService;
  })
);
