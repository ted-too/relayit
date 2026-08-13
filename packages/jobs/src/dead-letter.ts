import { DB } from "@repo/persistence/db/effect";
import { Context, Data, DateTime, Effect, Layer } from "effect";
import { type DeadLetterFailure, jobDeadLetter } from "./dead-letter-schema";

export type { DeadLetterFailure } from "./dead-letter-schema";

export interface DeadLetterInput {
  readonly attempts: number;
  readonly failedAt: number;
  readonly failure: DeadLetterFailure;
  readonly firstEnqueuedAt: number;
  readonly jobName: string;
  readonly originalStreamId: string;
  readonly payload: string;
  readonly wireVersion: number;
}

export interface DeadLetterRecord {
  readonly id: string;
}

export class DeadLetterStoreError extends Data.TaggedError(
  "DeadLetterStoreError"
)<{
  readonly cause: unknown;
  readonly operation: "record";
}> {}

export interface DeadLetterStoreService {
  readonly record: (
    input: DeadLetterInput
  ) => Effect.Effect<DeadLetterRecord, DeadLetterStoreError>;
}

export class DeadLetterStore extends Context.Service<
  DeadLetterStore,
  DeadLetterStoreService
>()("Jobs/DeadLetterStore") {}

export const DeadLetterStoreLive = Layer.effect(
  DeadLetterStore,
  Effect.gen(function* () {
    const db = yield* DB;

    return {
      record: (input) =>
        DateTime.nowAsDate.pipe(
          Effect.flatMap((updatedAt) =>
            db
              .insert(jobDeadLetter)
              .values({
                attempts: input.attempts,
                failedAt: DateTime.toDate(DateTime.makeUnsafe(input.failedAt)),
                failure: input.failure,
                firstEnqueuedAt: DateTime.toDate(
                  DateTime.makeUnsafe(input.firstEnqueuedAt)
                ),
                jobName: input.jobName,
                originalStreamId: input.originalStreamId,
                payload: input.payload,
                wireVersion: input.wireVersion,
              })
              .onConflictDoUpdate({
                set: { updatedAt },
                target: [jobDeadLetter.jobName, jobDeadLetter.originalStreamId],
              })
              .returning({ id: jobDeadLetter.id })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new DeadLetterStoreError({
                      cause,
                      operation: "record",
                    })
                ),
                Effect.flatMap(([record]) =>
                  record
                    ? Effect.succeed(record)
                    : Effect.fail(
                        new DeadLetterStoreError({
                          cause: new Error(
                            "Dead-letter insert returned no record"
                          ),
                          operation: "record",
                        })
                      )
                )
              )
          )
        ),
    } satisfies DeadLetterStoreService;
  })
);
