import { describe, expect, test } from "bun:test";
import { makeRedisLive } from "@repo/redis";
import { Effect } from "effect";
import {
  providerCircuitAllow,
  providerCircuitRecordFailure,
  providerCircuitRecordSuccess,
} from "./circuit";

const testRedisUrl = Bun.env.TEST_REDIS_URL;
const testName = "provider circuit opens after consecutive failures";

describe("Message delivery provider circuit", () => {
  if (!testRedisUrl) {
    process.emitWarning(
      "Skipping provider circuit tests: TEST_REDIS_URL is not set"
    );
    // biome-ignore lint/suspicious/noSkippedTests: The Redis test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  test(testName, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const providerId = `prov_${Bun.randomUUIDv7()}`;
        expect(yield* providerCircuitAllow(providerId)).toBe(true);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          yield* providerCircuitRecordFailure(providerId);
        }
        expect(yield* providerCircuitAllow(providerId)).toBe(false);
        yield* providerCircuitRecordSuccess(providerId);
        expect(yield* providerCircuitAllow(providerId)).toBe(true);
      }).pipe(Effect.provide(makeRedisLive({ url: testRedisUrl })))
    )
  );
});
