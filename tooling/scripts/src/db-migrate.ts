/** `bun run db:migrate`: applies pending migrations to the root .env's local database. */
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { developmentEnv, requireLocal } from "./root-env";

const databaseUrl = requireLocal("DATABASE_URL", developmentEnv().DATABASE_URL);
await migrateOnStartup(databaseUrl);
console.log(`Migrations applied to ${new URL(databaseUrl).pathname.slice(1)}.`);
