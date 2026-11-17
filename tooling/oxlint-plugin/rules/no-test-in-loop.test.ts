import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-test-in-loop.ts";

const message = (name: string) =>
  `Do not call ${name}(…) inside a for loop. Use ${name}.each(cases)(name, …) instead.`;

ruleTester.run("no-test-in-loop", rule, {
  valid: [
    {
      name: "allows it.each and it.effect.each",
      filename: "fixture.test.ts",
      code: `
        import { it } from "@effect/vitest";
        import * as Effect from "effect/Effect";

        it.each([1, 2])("handles %s", (value) => {});
        it.effect.each([1, 2])("handles %s", (value) => Effect.succeed(value));
      `,
    },
    {
      name: "allows loops inside a test body",
      filename: "fixture.test.ts",
      code: `
        import { it } from "@effect/vitest";

        it("checks every value", () => {
          for (const value of [1, 2]) {
            if (value < 0) throw new Error("negative");
          }
        });
      `,
    },
    {
      name: "ignores node:test files, which have no .each",
      filename: "fixture.test.ts",
      code: `
        import { test } from "node:test";

        for (const value of [1, 2]) {
          test(\`handles \${value}\`, () => {});
        }
      `,
    },
    {
      name: "ignores non-test files",
      filename: "fixture.ts",
      code: `
        const it = (_name: string) => {};
        for (const value of ["a"]) it(value);
      `,
    },
  ],
  invalid: [
    {
      name: "reports it inside a for...of loop",
      filename: "fixture.test.ts",
      code: `
        import { it } from "@effect/vitest";

        for (const value of [1, 2]) {
          it(\`handles \${value}\`, () => {});
        }
      `,
      errors: [{ message: message("it") }],
    },
    {
      name: "reports it.effect inside a for loop nested in describe",
      filename: "fixture.test.ts",
      code: `
        import { describe, it } from "@effect/vitest";
        import * as Effect from "effect/Effect";

        describe("cases", () => {
          for (let index = 0; index < 2; index++) {
            it.effect(\`handles \${index}\`, () => Effect.void);
          }
        });
      `,
      errors: [{ message: message("it.effect") }],
    },
    {
      name: "reports test inside a for...in loop",
      filename: "fixture.test.ts",
      code: `
        import { test } from "vitest";

        for (const key in { a: 1 }) {
          test(key, () => {});
        }
      `,
      errors: [{ message: message("test") }],
    },
    {
      name: "reports a describe inside a loop once, not the tests inside it",
      filename: "fixture.test.ts",
      code: `
        import { describe, it } from "vitest";

        for (const bundle of ["a.js", "b.js"]) {
          describe(bundle, () => {
            it("first", () => {});
            it("second", () => {});
          });
        }
      `,
      errors: [{ message: message("describe") }],
    },
  ],
});
