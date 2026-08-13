import { describe, expect, test } from "bun:test";
import {
  makeSchemaJsonCodec,
  Redis,
  RedisCommandError,
  type RedisService,
} from "@repo/redis";
import { Data, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  type DeadLetterInput,
  DeadLetterStore,
  type DeadLetterStoreService,
} from "./dead-letter";
import { defineJob, defineJobHandler, type WorkExecution } from "./job";
import { encodeJob, jobEnvelopeSchema, REDIS_PAYLOAD_FIELD } from "./storage";
import {
  processJob,
  processJobBatch,
  promoteDelayedJobs,
  promoteScheduledJobs,
  reclaimStaleJobs,
  registerJobHandler,
} from "./worker";

const deliverEmail = defineJob({
  name: "email.deliver",
  payload: Schema.Struct({ deliveryId: Schema.String }),
  retry: {
    backoff: { baseDelayMs: 1000, maxDelayMs: 30_000 },
    maxAttempts: 3,
  },
});

const verifyDomain = defineJob({
  name: "email.verify-domain",
  payload: Schema.Struct({ domainId: Schema.String }),
  recurrence: {
    identity: ({ domainId }) => domainId,
  },
  retry: {
    backoff: { baseDelayMs: 1000, maxDelayMs: 30_000 },
    maxAttempts: 3,
  },
});

class TestJobFailure extends Data.TaggedError("TestJobFailure")<{
  readonly code?: string;
  readonly message: string;
  readonly providerId?: string;
  readonly retryAfterMs?: number;
}> {}

const makeRedisRecorder = (
  entries: readonly {
    readonly fields: readonly string[];
    readonly id: string;
    readonly stream: string;
  }[] = [],
  claimedEntries: readonly {
    readonly fields: readonly string[];
    readonly id: string;
  }[] = [],
  acknowledgeFailure?: RedisCommandError
) => {
  const acknowledged: string[] = [];
  const delayed: Array<{
    readonly key: string;
    readonly member: string;
    readonly score: number;
  }> = [];
  const claims: unknown[] = [];
  const evaluations: Array<{
    readonly args: readonly string[];
    readonly keys: readonly string[];
    readonly script: string;
  }> = [];
  const reads: unknown[] = [];

  const service = {
    acknowledge: ({ id }) => {
      acknowledged.push(id);
      return acknowledgeFailure
        ? Effect.fail(acknowledgeFailure)
        : Effect.succeed(1);
    },
    append: () => Effect.succeed("1-0"),
    autoClaim: (input) => {
      claims.push(input);
      return Effect.succeed({
        entries: claimedEntries,
        nextStart: "0-0",
      });
    },
    createConsumerGroup: () => Effect.void,
    evaluateNumber: (input) => {
      evaluations.push(input);
      return Effect.succeed(0);
    },
    evaluateString: () => Effect.succeed(""),
    ping: Effect.void,
    readGroup: (input) => {
      reads.push(input);
      return Effect.succeed(entries);
    },
    sortedSetAdd: (input) => {
      delayed.push(input);
      return Effect.succeed(1);
    },
    sortedSetRemove: () => Effect.succeed(1),
  } satisfies RedisService;

  return {
    acknowledged,
    claims,
    delayed,
    evaluations,
    layer: Layer.succeed(Redis, service),
    reads,
  };
};

const makeDeadLetterRecorder = () => {
  const records: DeadLetterInput[] = [];
  const service = {
    record: (input) => {
      records.push(input);
      return Effect.succeed({ id: "jdl_test" });
    },
  } satisfies DeadLetterStoreService;

  return {
    layer: Layer.succeed(DeadLetterStore, service),
    records,
  };
};

describe("job execution", () => {
  test("executes a valid job and acknowledges it", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const handled: Array<{
      execution: WorkExecution;
      payload: { readonly deliveryId: string };
    }> = [];
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: (payload, execution) =>
        Effect.sync(() => {
          handled.push({ execution, payload });
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_1" },
          1000
        );

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "10-0",
        });

        expect(handled).toEqual([
          {
            execution: { attempt: 1, enqueuedAt: 1000, id: "10-0" },
            payload: { deliveryId: "delivery_1" },
          },
        ]);
        expect(redis.acknowledged).toEqual(["10-0"]);
      }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)))
    );
  });

  test("adds job context when acknowledgement fails", () => {
    const cause = new RedisCommandError({
      cause: new TypeError("Connection closed"),
      operation: "acknowledge",
    });
    const redis = makeRedisRecorder([], [], cause);
    const deadLetters = makeDeadLetterRecorder();
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () => Effect.void,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_1" },
          1000
        );
        const error = yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "10-1",
        }).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "JobProcessingError",
          cause,
          entryId: "10-1",
          jobName: "email.deliver",
          stage: "acknowledge",
        });
      }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)))
    );
  });

  test("schedules a failed job for retry before acknowledging it", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () =>
        Effect.fail(new TestJobFailure({ message: "Provider unavailable" })),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_2" },
          1000
        );

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "11-0",
        });

        expect(redis.acknowledged).toEqual(["11-0"]);
        expect(redis.delayed).toHaveLength(1);
        expect(redis.delayed[0]?.key).toBe(
          "relayit:jobs:email.deliver:delayed"
        );
        expect(redis.delayed[0]?.score).toBe(6000);

        const retry = yield* makeSchemaJsonCodec(jobEnvelopeSchema).decode(
          redis.delayed[0]?.member ?? ""
        );
        expect(retry.attempts).toBe(1);
        expect(retry.firstEnqueuedAt).toBe(1000);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("cleans up a terminal failure before dead-lettering without retrying", () => {
    const redis = makeRedisRecorder();
    const events: string[] = [];
    const deadLetters = {
      layer: Layer.succeed(DeadLetterStore, {
        record: (_input: DeadLetterInput) =>
          Effect.sync(() => {
            events.push("dead-letter");
            return { id: "jdl_test" };
          }),
      } satisfies DeadLetterStoreService),
    };
    const failure = new TestJobFailure({
      code: "delivery_suppressed",
      message: "Recipient is suppressed",
    });
    const handler = defineJobHandler({
      classifyFailure: () => "terminal",
      contract: deliverEmail,
      handle: () => Effect.fail(failure),
      onDeadLetter: (_payload, _execution, deadLetterFailure) =>
        Effect.sync(() => {
          expect(deadLetterFailure).toBe(failure);
          events.push("cleanup");
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_terminal" },
          1000
        );

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "11-1",
        });

        expect(events).toEqual(["cleanup", "dead-letter"]);
        expect(redis.delayed).toHaveLength(0);
        expect(redis.acknowledged).toEqual(["11-1"]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("leaves a terminal job pending when dead-letter cleanup fails", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const cleanupFailure = new TestJobFailure({
      message: "Usage release failed",
    });
    const handler = defineJobHandler({
      classifyFailure: () => "terminal",
      contract: deliverEmail,
      handle: () =>
        Effect.fail(
          new TestJobFailure({
            message: "Recipient is suppressed",
          })
        ),
      onDeadLetter: () => Effect.fail(cleanupFailure),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_cleanup_failure" },
          1000
        );
        const error = yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "11-2",
        }).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "JobProcessingError",
          cause: cleanupFailure,
          entryId: "11-2",
          jobName: "email.deliver",
          stage: "dead-letter-cleanup",
        });
        expect(deadLetters.records).toHaveLength(0);
        expect(redis.acknowledged).toHaveLength(0);
      }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)))
    );
  });

  test("dead-letters an exhausted job before acknowledging it", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const cleanedUp: string[] = [];
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () =>
        Effect.fail(
          new TestJobFailure({
            code: "provider_unavailable",
            message: "Provider unavailable",
            providerId: "provider_1",
            retryAfterMs: 5000,
          })
        ),
      onDeadLetter: ({ deliveryId }) =>
        Effect.sync(() => {
          cleanedUp.push(deliveryId);
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        const initial = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_3" },
          1000
        );
        const envelopeCodec = makeSchemaJsonCodec(jobEnvelopeSchema);
        const envelope = yield* envelopeCodec.decode(initial);
        const exhausted = yield* envelopeCodec.encode({
          ...envelope,
          attempts: 2,
        });

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, exhausted],
          id: "12-0",
        });

        expect(deadLetters.records).toEqual([
          {
            attempts: 3,
            failedAt: 5000,
            failure: {
              code: "provider_unavailable",
              details: {
                providerId: "provider_1",
                retryAfterMs: 5000,
              },
              message: "Provider unavailable",
              name: "TestJobFailure",
            },
            firstEnqueuedAt: 1000,
            jobName: "email.deliver",
            originalStreamId: "12-0",
            payload: envelope.data,
            wireVersion: 1,
          },
        ]);
        expect(cleanedUp).toEqual(["delivery_3"]);
        expect(redis.acknowledged).toEqual(["12-0"]);
        expect(redis.delayed).toHaveLength(0);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("dead-letters an invalid payload without calling its handler", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    let handled = false;
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () =>
        Effect.sync(() => {
          handled = true;
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        const malformed = yield* makeSchemaJsonCodec(jobEnvelopeSchema).encode({
          attempts: 0,
          data: '{"deliveryId":42}',
          firstEnqueuedAt: 1000,
          wireVersion: 1,
        });

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, malformed],
          id: "13-0",
        });

        expect(handled).toBe(false);
        expect(deadLetters.records).toEqual([
          {
            attempts: 1,
            failedAt: 5000,
            failure: {
              code: "JOB_PAYLOAD_INVALID",
              message: "Job payload could not be decoded",
              name: "JobDecodeFailure",
            },
            firstEnqueuedAt: 1000,
            jobName: "email.deliver",
            originalStreamId: "13-0",
            payload: '{"deliveryId":42}',
            wireVersion: 1,
          },
        ]);
        expect(redis.acknowledged).toEqual(["13-0"]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("dead-letters an invalid envelope so it cannot poison the stream", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () => Effect.void,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, "not-json"],
          id: "14-0",
        });

        expect(deadLetters.records).toEqual([
          {
            attempts: 1,
            failedAt: 5000,
            failure: {
              code: "JOB_ENVELOPE_INVALID",
              message: "Job envelope could not be decoded",
              name: "JobDecodeFailure",
            },
            firstEnqueuedAt: 5000,
            jobName: "email.deliver",
            originalStreamId: "14-0",
            payload: "not-json",
            wireVersion: 0,
          },
        ]);
        expect(redis.acknowledged).toEqual(["14-0"]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("dispatches entries from registered streams in one blocking batch", () => {
    const deadLetters = makeDeadLetterRecorder();
    const handled: string[] = [];
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: ({ deliveryId }) =>
        Effect.sync(() => {
          handled.push(deliveryId);
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_4" },
          1000
        );
        const redis = makeRedisRecorder([
          {
            fields: [REDIS_PAYLOAD_FIELD, payload],
            id: "15-0",
            stream: "relayit:jobs:email.deliver:ready",
          },
        ]);

        yield* processJobBatch([registerJobHandler(handler)], {
          blockMs: 5000,
          concurrency: 4,
          consumer: "api-1",
          count: 10,
        }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)));

        expect(handled).toEqual(["delivery_4"]);
        expect(redis.reads).toEqual([
          {
            blockMs: 5000,
            consumer: "api-1",
            count: 10,
            group: "relayit:jobs:workers",
            streams: ["relayit:jobs:email.deliver:ready"],
          },
        ]);
        expect(redis.acknowledged).toEqual(["15-0"]);
      })
    );
  });

  test("promotes due delayed jobs for every registered stream", () => {
    const redis = makeRedisRecorder();
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () => Effect.void,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5000);
        yield* promoteDelayedJobs([registerJobHandler(handler)], {
          limit: 25,
        });

        expect(redis.evaluations).toHaveLength(1);
        expect(redis.evaluations[0]?.keys).toEqual([
          "relayit:jobs:email.deliver:delayed",
          "relayit:jobs:email.deliver:ready",
        ]);
        expect(redis.evaluations[0]?.args).toEqual(["5000", "25"]);
      }).pipe(Effect.provide(Layer.merge(redis.layer, TestClock.layer())))
    );
  });

  test("registers recurring jobs with scheduled keys and runs reconcile once", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const reconciles: string[] = [];
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: verifyDomain,
      handle: () => Effect.void,
      reconcile: Effect.sync(() => {
        reconciles.push("verify-domain");
      }),
    });

    const registration = registerJobHandler(handler);
    expect(registration.scheduledKey).toBe(
      "relayit:jobs:email.verify-domain:scheduled"
    );
    expect(registration.payloadsKey).toBe(
      "relayit:jobs:email.verify-domain:payloads"
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* (registration.reconcile ?? Effect.void).pipe(
          Effect.provide(Layer.merge(redis.layer, deadLetters.layer))
        );
        expect(reconciles).toEqual(["verify-domain"]);
      })
    );
  });

  test("promotes due scheduled recurring jobs for every recurring registration", () => {
    const redis = makeRedisRecorder();
    const recurring = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: verifyDomain,
      handle: () => Effect.void,
    });
    const ordinary = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: () => Effect.void,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(7000);
        yield* promoteScheduledJobs(
          [registerJobHandler(ordinary), registerJobHandler(recurring)],
          { limit: 10 }
        );

        expect(redis.evaluations).toHaveLength(1);
        expect(redis.evaluations[0]?.keys).toEqual([
          "relayit:jobs:email.verify-domain:scheduled",
          "relayit:jobs:email.verify-domain:payloads",
          "relayit:jobs:email.verify-domain:ready",
        ]);
        expect(redis.evaluations[0]?.args).toEqual(["7000", "10"]);
      }).pipe(Effect.provide(Layer.merge(redis.layer, TestClock.layer())))
    );
  });

  test("retries a failed recurring job through the normal delayed path", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: verifyDomain,
      handle: () =>
        Effect.fail(
          new TestJobFailure({
            message: "DNS not ready",
          })
        ),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(2000);
        const payload = yield* encodeJob(
          verifyDomain,
          { domainId: "domain_1" },
          1000
        );

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, payload],
          id: "20-0",
        });

        expect(deadLetters.records).toHaveLength(0);
        expect(redis.delayed).toHaveLength(1);
        expect(redis.delayed[0]?.key).toBe(
          "relayit:jobs:email.verify-domain:delayed"
        );
        expect(redis.delayed[0]?.score).toBe(3000);
        expect(redis.acknowledged).toEqual(["20-0"]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(redis.layer, deadLetters.layer, TestClock.layer())
        )
      )
    );
  });

  test("dead-letters an invalid recurring payload without calling its handler", () => {
    const redis = makeRedisRecorder();
    const deadLetters = makeDeadLetterRecorder();
    let handled = 0;
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: verifyDomain,
      handle: () =>
        Effect.sync(() => {
          handled += 1;
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const envelope = yield* makeSchemaJsonCodec(jobEnvelopeSchema).encode({
          attempts: 0,
          data: '{"not":"valid"}',
          firstEnqueuedAt: 1000,
          wireVersion: 1,
        });

        yield* processJob(handler, {
          fields: [REDIS_PAYLOAD_FIELD, envelope],
          id: "21-0",
        }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)));

        expect(handled).toBe(0);
        expect(deadLetters.records).toHaveLength(1);
        expect(deadLetters.records[0]?.failure.code).toBe(
          "JOB_PAYLOAD_INVALID"
        );
        expect(redis.acknowledged).toEqual(["21-0"]);
      })
    );
  });

  test("reclaims stale pending jobs and processes them normally", () => {
    const deadLetters = makeDeadLetterRecorder();
    const handled: string[] = [];
    const handler = defineJobHandler({
      classifyFailure: () => "retryable",
      contract: deliverEmail,
      handle: ({ deliveryId }) =>
        Effect.sync(() => {
          handled.push(deliveryId);
        }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* encodeJob(
          deliverEmail,
          { deliveryId: "delivery_5" },
          1000
        );
        const redis = makeRedisRecorder(
          [],
          [
            {
              fields: [REDIS_PAYLOAD_FIELD, payload],
              id: "16-0",
            },
          ]
        );

        yield* reclaimStaleJobs([registerJobHandler(handler)], {
          concurrency: 4,
          consumer: "api-1",
          count: 10,
          minIdleMs: 30_000,
        }).pipe(Effect.provide(Layer.merge(redis.layer, deadLetters.layer)));

        expect(handled).toEqual(["delivery_5"]);
        expect(redis.claims).toEqual([
          {
            consumer: "api-1",
            count: 10,
            group: "relayit:jobs:workers",
            minIdleMs: 30_000,
            start: "0-0",
            stream: "relayit:jobs:email.deliver:ready",
          },
        ]);
        expect(redis.acknowledged).toEqual(["16-0"]);
      })
    );
  });
});
