import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted } from "effect";
import { types } from "pg";
import { relations } from "../relations";

const DATE_TIME_TYPE_OIDS = [
  1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182,
] as const;

export interface DatabaseConfig {
  databaseUrl: string;
}

const dbEffect = PgDrizzle.make({ relations }).pipe(
  Effect.provide(PgDrizzle.DefaultServices)
);

export type Database = Effect.Success<typeof dbEffect>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export class DB extends Context.Service<DB, Effect.Success<typeof dbEffect>>()(
  "PersistenceDB"
) {}

const makePgClientLive = ({ databaseUrl }: DatabaseConfig) =>
  PgClient.layer({
    types: {
      getTypeParser: (typeId, format) => {
        if ((DATE_TIME_TYPE_OIDS as readonly number[]).includes(typeId)) {
          return (value: string) => value;
        }

        return types.getTypeParser(typeId, format);
      },
    },
    url: Redacted.make(databaseUrl),
  });

const DbLive = Layer.effect(DB, dbEffect);

export const makeDbLive = (config: DatabaseConfig) =>
  Layer.provideMerge(DbLive, makePgClientLive(config));
