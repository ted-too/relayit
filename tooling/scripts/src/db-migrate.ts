/** `bun run db:migrate`: applies pending migrations to the root .env's local database. */
import { migrateDatabase } from "@repo/persistence/db/migrate";
import { Effect } from "effect";
import { developmentEnv, requireLocal } from "./root-env";

const databaseUrl = requireLocal("DATABASE_URL", developmentEnv().DATABASE_URL);
await Effect.runPromise(migrateDatabase({ databaseUrl, waitFor: 0 }));
console.log(`Migrations applied to ${new URL(databaseUrl).pathname.slice(1)}.`);
