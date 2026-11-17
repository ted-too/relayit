import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-erased-job-requirements.ts";

const message =
  "Do not cast at the `runJobWorker` call: let it infer the union of the handlers' requirements, so a missing Layer is a type error.";

ruleTester.run("no-erased-job-requirements", rule, {
  valid: [
    {
      name: "allows an uncast call",
      code: `
        export const worker = runJobWorker(
          [registerJobHandler(email), registerJobHandler(webhook)],
          options,
        );
      `,
    },
    {
      name: "ignores casts on other calls",
      code: `export const db = makeDb() as never;`,
    },
  ],
  invalid: [
    {
      name: "reports casting the handler list",
      code: `
        export const worker = runJobWorker(
          [registerJobHandler(email), registerJobHandler(webhook)] as never,
          options,
        );
      `,
      errors: [{ message }],
    },
    {
      name: "reports pinning the worker's type",
      code: `
        export const worker = runJobWorker(handlers, options) as Effect.Effect<void, never, never>;
      `,
      errors: [{ message }],
    },
  ],
});
