import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-empty-job-payload.ts";

const message =
  "Omit `payload` from a job with none; producers use the no-payload overloads instead of passing `{}`.";

ruleTester.run("no-empty-job-payload", rule, {
  valid: [
    {
      name: "allows a job without a payload",
      code: `
        export const verifyJob = defineJob({
          name: "email.verify-platform-spf",
          recurrence: { identity: () => "platform" },
        });
      `,
    },
    {
      name: "allows a payload with fields",
      code: `
        export const deliverJob = defineJob({
          name: "email.deliver",
          payload: Schema.Struct({ deliveryId: Schema.String }),
        });
      `,
    },
    {
      name: "ignores empty structs outside defineJob",
      code: `export const Empty = Schema.Struct({});`,
    },
  ],
  invalid: [
    {
      name: "reports Schema.Struct({})",
      code: `
        export const verifyJob = defineJob({
          name: "email.verify-platform-spf",
          payload: Schema.Struct({}),
        });
      `,
      errors: [{ message }],
    },
    {
      name: "reports a named Struct import",
      code: `export const verifyJob = defineJob({ name: "verify", payload: Struct({}) });`,
      errors: [{ message }],
    },
  ],
});
