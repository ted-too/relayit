import { describe, expect, test } from "bun:test";
import { makeRedisClient, makeRedisLive, Redis } from "@repo/redis";
import { Effect, Layer, Schema } from "effect";
import { Jobs, JobsLive } from "./client";
import { DeadLetterStore } from "./dead-letter";
import { defineJob, defineJobHandler } from "./job";
import { JOB_WORKER_GROUP, jobKeys } from "./storage";
import { processJobBatch, registerJobHandler } from "./worker";

const testRedisUrl = Bun.env.TEST_REDIS_URL;
const testName = "a job enqueued under one key prefix is consumed only under that prefix";

const isolationJob = defineJob({
  name: "test.key-prefix-isolation",
  payload: Schema.Struct({ sentFrom: Schema.String }),
  retry: { backoff: { baseDelayMs: 1000, maxDelayMs: 1000 }, maxAttempts: 1 },
});

describe("Redis key prefixes", () => {
  if (!testRedisUrl) {
    process.emitWarning("Skipping key prefix integration test: TEST_REDIS_URL is not set");
    // The Redis test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  test(testName, async () => {
    const run = Bun.randomUUIDv7();
    const prefixes = { a: `test:${run}:a:`, b: `test:${run}:b:` };
    const consumed: Record<"a" | "b", string[]> = { a: [], b: [] };

    const checkout = (name: "a" | "b") => {
      const redisLive = makeRedisLive({ keyPrefix: prefixes[name], url: testRedisUrl });
      return Layer.mergeAll(
        Layer.provideMerge(JobsLive, redisLive),
        Layer.succeed(DeadLetterStore, { record: () => Effect.die("no job should dead-letter") }),
      );
    };
    const consume = (name: "a" | "b") =>
      Effect.gen(function* () {
        const redis = yield* Redis;
        const registration = registerJobHandler(
          defineJobHandler({
            classifyFailure: () => "terminal",
            contract: isolationJob,
            handle: ({ sentFrom }) => Effect.sync(() => consumed[name].push(sentFrom)),
          }),
        );
        yield* redis.createConsumerGroup({ group: JOB_WORKER_GROUP, stream: registration.stream });
        yield* processJobBatch([registration], {
          blockMs: 200,
          concurrency: 1,
          consumer: `test-${name}`,
          count: 10,
        });
      }).pipe(Effect.provide(checkout(name)));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const jobs = yield* Jobs;
          yield* jobs.enqueue(isolationJob, { sentFrom: "a" });
        }).pipe(Effect.provide(checkout("a"))),
      );

      await Effect.runPromise(consume("b"));
      expect(consumed.b).toEqual([]);

      await Effect.runPromise(consume("a"));
      expect(consumed.a).toEqual(["a"]);
    } finally {
      const client = makeRedisClient({ url: testRedisUrl });
      const stream = jobKeys(isolationJob.name).ready;
      await client.send("DEL", [prefixes.a + stream, prefixes.b + stream]);
      client.close();
    }
  });
});
