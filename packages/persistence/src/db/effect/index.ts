import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted } from "effect";
import { relations } from "../relations";

export interface DatabaseConfig {
  databaseUrl: string;
}

const dbEffect = PgDrizzle.make({ relations }).pipe(Effect.provide(PgDrizzle.DefaultServices));

export type Database = Effect.Success<typeof dbEffect>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export class DB extends Context.Service<DB, Effect.Success<typeof dbEffect>>()("PersistenceDB") {}

/**
 * The time zone every session runs in. Our columns are `timestamp` without time zone and the
 * app writes UTC into them, but a `created_at` Postgres fills with `now()` takes the
 * session's wall clock: under a server, database or role default in another zone it is off
 * by that zone's offset from everything the app wrote or compares it with (#167). The
 * session's zone is therefore ours, not the server's.
 */
export const SESSION_TIME_ZONE = "UTC";

const makePgClientLive = ({ databaseUrl }: DatabaseConfig) =>
  PgClient.layer({
    startupParameters: { timezone: SESSION_TIME_ZONE },
    url: Redacted.make(databaseUrl),
  });

const DbLive = Layer.effect(DB, dbEffect);

export const makeDbLive = (config: DatabaseConfig) =>
  Layer.provideMerge(DbLive, makePgClientLive(config));
