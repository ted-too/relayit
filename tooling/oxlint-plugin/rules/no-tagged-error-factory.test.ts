import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-tagged-error-factory.ts";

const message = (name: string) =>
  `Construct ${name} where it is raised, with its named fields, rather than through a factory function.`;

ruleTester.run("no-tagged-error-factory", rule, {
  valid: [
    {
      name: "allows constructing the error inline in mapError",
      code: `
        export const program = load.pipe(
          Effect.mapError((cause) => new MessageDeliveryInfrastructureError({ cause, operation: "circuit" })),
        );
      `,
    },
    {
      name: "allows constructing the error where it is raised",
      code: `
        export const program = Effect.gen(function* () {
          return yield* new MessageDeliveryTerminalError({ deliveryId: "d", message: "not found", stage: "load" });
        });
      `,
    },
    {
      name: "allows a function that does more than construct the error",
      code: `
        const classify = (cause: unknown) => {
          logCause(cause);
          return new MessageDeliveryRetryableError({ cause });
        };
      `,
    },
    {
      name: "allows a factory for a built-in error",
      code: `const fail = (message: string) => new Error(message);`,
    },
    {
      name: "allows a factory for a class that is not an error",
      code: `const makeClient = (url: string) => new Client({ url });`,
    },
  ],
  invalid: [
    {
      name: "reports an arrow factory with positional arguments",
      code: `
        export const emailDeliveryTerminal = (deliveryId: string, stage: string, message: string, cause?: unknown) =>
          new MessageDeliveryTerminalError({ cause, deliveryId, message, stage });
      `,
      errors: [{ message: message("MessageDeliveryTerminalError") }],
    },
    {
      name: "reports a local factory passed to mapError",
      code: `
        const circuitError = (cause: unknown) =>
          new MessageDeliveryInfrastructureError({ cause, operation: "circuit" });
        export const program = load.pipe(Effect.mapError(circuitError));
      `,
      errors: [{ message: message("MessageDeliveryInfrastructureError") }],
    },
    {
      name: "reports a curried factory",
      code: `
        const infrastructureError = (organizationId: string, operation: "sender") => (cause: unknown) =>
          new EmailAcceptInfrastructureError({ cause, operation, organizationId });
      `,
      errors: [{ message: message("EmailAcceptInfrastructureError") }],
    },
    {
      name: "reports a function declaration with a single return",
      code: `
        function notFound(deliveryId: string) {
          return new MessageDeliveryTerminalError({ deliveryId, message: "not found", stage: "load" });
        }
      `,
      errors: [{ message: message("MessageDeliveryTerminalError") }],
    },
  ],
});
