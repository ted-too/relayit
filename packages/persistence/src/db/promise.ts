import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DatabaseConfig } from "./effect";
import { relations } from "./relations";

export interface PromiseDbConfig extends DatabaseConfig {
  /**
   * Called when an idle pooled connection drops (Postgres restart, failover).
   * The pool has already discarded that connection and will open a fresh one
   * on the next checkout; this hook exists for logging.
   */
  onPoolError?: (error: Error) => void;
}

export const createPromiseDb = ({
  databaseUrl,
  onPoolError,
}: PromiseDbConfig) => {
  const pool = new Pool({ connectionString: databaseUrl });
  // Without a listener `pg.Pool` re-raises idle-connection errors as an
  // unhandled `error` event, which takes the whole process down.
  pool.on("error", (error) => onPoolError?.(error));

  return drizzle({
    client: pool,
    relations,
  });
};

export type PromiseDb = ReturnType<typeof createPromiseDb>;
export type PromiseTransaction = Parameters<
  Parameters<PromiseDb["transaction"]>[0]
>[0];
export type PromiseDbOrTransaction = PromiseDb | PromiseTransaction;
