import { describe, expect, test } from "bun:test";
import { makeDbLive } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  type DeadLetterInput,
  DeadLetterStore,
  DeadLetterStoreLive,
} from "./dead-letter";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "recording the same failed stream twice returns its stable ID";

describe("dead-letter persistence", () => {
  if (!testDatabaseUrl) {
    process.emitWarning(
      "Skipping DLQ integration test: TEST_DATABASE_URL is not set"
    );
    // biome-ignore lint/suspicious/noSkippedTests: The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  const deadLetter: DeadLetterInput = {
    attempts: 3,
    failedAt: 2000,
    failure: {
      message: "Provider unavailable",
      name: "ProviderError",
    },
    firstEnqueuedAt: 1000,
    jobName: "email.deliver",
    originalStreamId: Bun.randomUUIDv7(),
    payload: '{"deliveryId":"delivery_1"}',
    wireVersion: 1,
  };

  test(testName, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DeadLetterStore;
        const first = yield* store.record(deadLetter);
        const second = yield* store.record(deadLetter);

        expect(second.id).toBe(first.id);
      }).pipe(
        Effect.provide(
          DeadLetterStoreLive.pipe(
            Layer.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))
          )
        )
      )
    )
  );
});
