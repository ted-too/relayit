import { describe, expect, test } from "bun:test";
import { defineJob, Jobs, JobsLive } from "@repo/jobs";
import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import {
  makeSchemaJsonCodec,
  Redis,
  RedisCommandError,
  type RedisService,
} from "@repo/redis";
import { Effect, Layer, Schema } from "effect";
import { jobEnvelopeSchema } from "./storage";

interface RecordedAppend {
  readonly fields: Readonly<Record<string, string>>;
  readonly stream: string;
}

interface RecordedSortedSet {
  readonly key: string;
  readonly member: string;
  readonly score: number;
}

interface RecordedEvaluation {
  readonly args: readonly string[];
  readonly keys: readonly string[];
  readonly script: string;
}

const makeRedisRecorder = (appendFailure?: RedisCommandError) => {
  const appends: RecordedAppend[] = [];
  const evaluations: RecordedEvaluation[] = [];
  const sortedSetAdds: RecordedSortedSet[] = [];

  const service = {
    acknowledge: () => Effect.succeed(1),
    append: (input) => {
      appends.push(input);
      return appendFailure ? Effect.fail(appendFailure) : Effect.succeed("1-0");
    },
    autoClaim: () => Effect.succeed({ entries: [], nextStart: "0-0" }),
    createConsumerGroup: () => Effect.void,
    evaluateNumber: (input) => {
      evaluations.push(input);
      return Effect.succeed(0);
    },
    evaluateString: () => Effect.succeed(""),
    ping: Effect.void,
    readGroup: () => Effect.succeed([]),
    sortedSetAdd: (input) => {
      sortedSetAdds.push(input);
      return Effect.succeed(1);
    },
    sortedSetRemove: () => Effect.succeed(1),
  } satisfies RedisService;

  return {
    appends,
    evaluations,
    layer: Layer.succeed(Redis, service),
    sortedSetAdds,
  };
};

const deliverEmail = defineJob({
  name: "email.deliver",
  payload: Schema.Struct({ deliveryId: Schema.String }),
  retry: {
    backoff: { baseDelayMs: 1000, maxDelayMs: 30_000 },
    maxAttempts: 3,
  },
});

const deliverEmailTransactionally = defineJob({
  dispatch: "transactional",
  name: "email.deliver-transactionally",
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

describe("job producers", () => {
  test("enqueues a typed queued-job envelope", () => {
    const redis = makeRedisRecorder();

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        yield* jobs.enqueue(deliverEmail, { deliveryId: "delivery_1" });

        expect(redis.appends).toHaveLength(1);
        expect(redis.appends[0]?.stream).toBe(
          "relayit:jobs:email.deliver:ready"
        );

        const envelope = yield* makeSchemaJsonCodec(jobEnvelopeSchema).decode(
          redis.appends[0]?.fields.payload ?? ""
        );
        const payload = yield* makeSchemaJsonCodec(deliverEmail.payload).decode(
          envelope.data
        );

        expect(envelope.attempts).toBe(0);
        expect(payload).toEqual({ deliveryId: "delivery_1" });
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });

  test("reports the enqueue stage and underlying Redis error", () => {
    const cause = new RedisCommandError({
      cause: new TypeError("Connection closed"),
      operation: "append",
    });
    const redis = makeRedisRecorder(cause);

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        const error = yield* jobs
          .enqueue(deliverEmail, { deliveryId: "delivery_1" })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "JobEnqueueError",
          cause,
          jobName: "email.deliver",
          stage: "append",
        });
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });

  test("delays queued jobs in the queue sorted set", () => {
    const redis = makeRedisRecorder();

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        yield* jobs.enqueue(
          deliverEmail,
          { deliveryId: "delivery_2" },
          { delayUntil: 5000 }
        );

        expect(redis.appends).toHaveLength(0);
        expect(redis.sortedSetAdds[0]?.key).toBe(
          "relayit:jobs:email.deliver:delayed"
        );
        expect(redis.sortedSetAdds[0]?.score).toBe(5000);
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });

  test("stages transactional jobs using the enqueue overload", () => {
    const redis = makeRedisRecorder();
    const inserts: unknown[] = [];
    const transaction = {
      insert: () => ({
        values: (values: unknown) => {
          inserts.push(values);
          return Effect.void;
        },
      }),
    } as unknown as DatabaseTransaction;

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        yield* jobs.enqueue(
          deliverEmailTransactionally,
          { deliveryId: "delivery_3" },
          transaction,
          { delayUntil: 5000 }
        );

        expect(redis.appends).toHaveLength(0);
        expect(redis.sortedSetAdds).toHaveLength(0);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({
          jobName: "email.deliver-transactionally",
        });
        expect(
          (inserts[0] as { readonly delayUntil: Date }).delayUntil.getTime()
        ).toBe(5000);
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });

  test("schedules and cancels a recurring job by stable identity", () => {
    const redis = makeRedisRecorder();

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        const payload = { domainId: "domain_1" };

        yield* jobs.schedule(verifyDomain, payload, 10_000);
        yield* jobs.cancel(verifyDomain, payload);

        expect(redis.evaluations[0]?.keys).toEqual([
          "relayit:jobs:email.verify-domain:scheduled",
          "relayit:jobs:email.verify-domain:payloads",
        ]);
        expect(redis.evaluations[0]?.args.slice(0, 2)).toEqual([
          "10000",
          "domain_1",
        ]);
        expect(redis.evaluations[1]?.keys).toEqual(redis.evaluations[0]?.keys);
        expect(redis.evaluations[1]?.args).toEqual(["domain_1"]);

        const envelope = yield* makeSchemaJsonCodec(jobEnvelopeSchema).decode(
          redis.evaluations[0]?.args[2] ?? ""
        );
        const decoded = yield* makeSchemaJsonCodec(verifyDomain.payload).decode(
          envelope.data
        );

        expect(envelope.attempts).toBe(0);
        expect(decoded).toEqual(payload);
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });

  test("schedules and cancels a unit recurring job without a payload arg", () => {
    const redis = makeRedisRecorder();
    const reconcilePlatform = defineJob({
      name: "email.verify-platform-spf",
      recurrence: {
        identity: () => "platform",
      },
      retry: {
        backoff: { baseDelayMs: 1000, maxDelayMs: 30_000 },
        maxAttempts: 3,
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* Jobs;
        yield* jobs.schedule(reconcilePlatform, 10_000);
        yield* jobs.cancel(reconcilePlatform);

        expect(redis.evaluations[0]?.args.slice(0, 2)).toEqual([
          "10000",
          "platform",
        ]);
        expect(redis.evaluations[1]?.args).toEqual(["platform"]);

        const envelope = yield* makeSchemaJsonCodec(jobEnvelopeSchema).decode(
          redis.evaluations[0]?.args[2] ?? ""
        );
        const decoded = yield* makeSchemaJsonCodec(
          reconcilePlatform.payload
        ).decode(envelope.data);
        expect(decoded).toBeNull();
      }).pipe(Effect.provide(JobsLive.pipe(Layer.provide(redis.layer))))
    );
  });
});
