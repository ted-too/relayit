import { drizzle } from "drizzle-orm/node-postgres";

import * as authSchema from "@repo/db/schema/auth";
import * as coreSchema from "@repo/db/schema/core";

export const schema = {
	...authSchema,
	...coreSchema,
};

export const db = drizzle({
	connection: {
		connectionString: process.env.DATABASE_URL,
		ssl: false,
	},
	schema,
});

export type Transaction = Parameters<typeof db.transaction>[0] extends (
	tx: infer T,
) => any
	? T
	: never;

export * from "./lib/crypto";
export * from "./lib/redis";
export * from "./lib/message-ops";
