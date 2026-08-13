import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/** Fixed identity — do not change after first deploy. */
const LOCK_KEY1 = 872_014_331;
const LOCK_KEY2 = 1;

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle"
);

/**
 * Apply pending Drizzle migrations under a Postgres session advisory lock.
 * Safe to call from every deployable on startup; losers wait, then no-op.
 */
export const migrateOnStartup = async (databaseUrl: string): Promise<void> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      LOCK_KEY1,
      LOCK_KEY2,
    ]);
    try {
      const db = drizzle({ client });
      const result = await migrate(db, { migrationsFolder });
      if (result != null) {
        throw new Error(
          `Database migration failed with exit code: ${result.exitCode}`
        );
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        LOCK_KEY1,
        LOCK_KEY2,
      ]);
    }
  } finally {
    await client.end();
  }
};
