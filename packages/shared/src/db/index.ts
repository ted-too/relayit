import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./schema/auth";
import * as contactSchema from "./schema/contact";
import * as enumsSchema from "./schema/enums";
import * as messageSchema from "./schema/message";
import * as providerSchema from "./schema/provider";
import * as systemSchema from "./schema/system";
import * as templateSchema from "./schema/template";

export const schema = {
  ...authSchema,
  ...contactSchema,
  ...providerSchema,
  ...messageSchema,
  ...templateSchema,
  ...systemSchema,
  ...enumsSchema,
};

export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  },
  schema,
});

export type DB = typeof db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export * from "./redis";
