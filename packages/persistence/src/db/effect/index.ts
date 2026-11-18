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

const makePgClientLive = ({ databaseUrl }: DatabaseConfig) =>
  PgClient.layer({ url: Redacted.make(databaseUrl) });

const DbLive = Layer.effect(DB, dbEffect);

export const makeDbLive = (config: DatabaseConfig) =>
  Layer.provideMerge(DbLive, makePgClientLive(config));
