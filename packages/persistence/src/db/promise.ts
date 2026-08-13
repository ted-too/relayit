import { drizzle } from "drizzle-orm/node-postgres";
import type { DatabaseConfig } from "./effect";
import { relations } from "./relations";

export const createPromiseDb = ({ databaseUrl }: DatabaseConfig) =>
  drizzle({
    connection: databaseUrl,
    relations,
  });

export type PromiseDb = ReturnType<typeof createPromiseDb>;
export type PromiseTransaction = Parameters<
  Parameters<PromiseDb["transaction"]>[0]
>[0];
export type PromiseDbOrTransaction = PromiseDb | PromiseTransaction;
