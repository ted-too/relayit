import { ruleTester } from "../test/ruleTester.ts";
import rule from "./prefer-db-aliases.ts";

const message =
  "Use `Database`, `DatabaseTransaction` or `DatabaseExecutor` from `@repo/persistence/db/effect` instead of `Effect.Success<typeof DB>`.";

ruleTester.run("prefer-db-aliases", rule, {
  valid: [
    {
      name: "allows the shared aliases",
      code: `
        import type { Database, DatabaseExecutor } from "@repo/persistence/db/effect";
        export const markSent = (db: Database, executor: DatabaseExecutor) => [db, executor];
      `,
    },
    {
      name: "allows Effect.Success of other services",
      code: `export type Client = Effect.Success<typeof RedisClient>;`,
    },
  ],
  invalid: [
    {
      name: "reports the whole client type",
      code: `export const markSent = (db: Effect.Success<typeof DB>) => db;`,
      errors: [{ message }],
    },
    {
      name: "reports a method picked off the client type",
      code: `
        export const updateDelivery = (db: { update: Effect.Success<typeof DB>["update"] }) => db;
      `,
      errors: [{ message }],
    },
  ],
});
