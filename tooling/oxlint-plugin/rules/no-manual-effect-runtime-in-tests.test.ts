import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-manual-effect-runtime-in-tests.ts";

const runners = [
  "Effect.runCallback",
  "Effect.runCallbackWith",
  "Effect.runFork",
  "Effect.runForkWith",
  "Effect.runPromise",
  "Effect.runPromiseExit",
  "Effect.runPromiseExitWith",
  "Effect.runPromiseWith",
  "Effect.runSync",
  "Effect.runSyncExit",
  "Effect.runSyncExitWith",
  "Effect.runSyncWith",
] as const;

const message = (runner: string) =>
  `Do not use ${runner} in tests. Use @effect/vitest with it.effect(...) and test layers instead.`;

ruleTester.run("no-manual-effect-runtime-in-tests", rule, {
  valid: [
    {
      name: "allows @effect/vitest effect tests",
      filename: "fixture.test.ts",
      code: `
        import { it } from "@effect/vitest";
        import * as Effect from "effect/Effect";

        it.effect("runs an Effect", () => Effect.succeed("ok"));
      `,
    },
    {
      name: "allows production runtime boundaries",
      filename: "main.ts",
      code: `
        import * as Effect from "effect/Effect";

        export const main = () => Effect.runPromise(Effect.void);
      `,
    },
    {
      name: "allows occurrences up to the maxOccurrences ceiling",
      filename: "legacy.test.ts",
      options: [{ maxOccurrences: 2 }],
      code: `
        import * as Effect from "effect/Effect";

        test("first", () => Effect.runSync(Effect.void));
        test("second", () => Effect.runSync(Effect.void));
      `,
    },
  ],
  invalid: [
    {
      name: "reports each Effect runner and ManagedRuntime.make",
      filename: "fixture.test.ts",
      code: `
        import * as Effect from "effect/Effect";
        import * as Layer from "effect/Layer";
        import * as ManagedRuntime from "effect/ManagedRuntime";

        test("runs Effects by hand", () => {
          ${runners.map((runner) => `${runner}(Effect.void);`).join("\n          ")}
          ManagedRuntime.make(Layer.empty);
        });
      `,
      errors: [...runners, "ManagedRuntime.make"].map((runner) => ({ message: message(runner) })),
    },
    {
      name: "reports occurrences beyond the maxOccurrences ceiling",
      filename: "legacy.test.ts",
      options: [{ maxOccurrences: 2 }],
      code: `
        import * as Effect from "effect/Effect";

        test("first", () => Effect.runSync(Effect.void));
        test("second", () => Effect.runSync(Effect.void));
        test("third", () => Effect.runSync(Effect.void));
      `,
      errors: [{ message: message("Effect.runSync"), line: 6 }],
    },
  ],
});
