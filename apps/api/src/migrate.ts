import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl.length === 0) {
    process.exit(1);
  }

  const client = postgres(dbUrl, {
    max: 1,
  });

  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } catch (_error) {
    await client.end(); // Ensure client is closed before exiting
    process.exit(1); // Exit with non-zero code on failure
  } finally {
    await client.end();
  }
}

runMigration().catch((_error) => {
  process.exit(1); // Exit with non-zero code on uncaught errors during setup/call
});
