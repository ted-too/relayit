import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { logLevelConfig } from "./logger";

const read = (env: Record<string, string>) =>
  logLevelConfig.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    Effect.result,
  );

describe("LOG_LEVEL", () => {
  it.effect("is read in any case, and is Info when unset or empty", () =>
    Effect.gen(function* () {
      for (const [written, level] of [
        ["info", "Info"],
        ["Info", "Info"],
        ["DEBUG", "Debug"],
        ["none", "None"],
      ] as const) {
        expect(yield* read({ LOG_LEVEL: written })).toMatchObject({ success: level });
      }
      expect(yield* read({})).toMatchObject({ success: "Info" });
      // As a platform's form leaves a variable nobody filled in.
      expect(yield* read({ LOG_LEVEL: "" })).toMatchObject({ success: "Info" });
    }),
  );

  it.effect("fails on a level that does not exist", () =>
    Effect.gen(function* () {
      expect(yield* read({ LOG_LEVEL: "verbose" })).toMatchObject({ _tag: "Failure" });
    }),
  );
});
