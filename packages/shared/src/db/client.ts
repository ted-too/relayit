import { drizzle } from "drizzle-orm/node-postgres";
import * as appSchema from "./schema/app";
import * as authSchema from "./schema/auth";
import * as contactSchema from "./schema/contact";
import * as messageSchema from "./schema/message";
import * as providerSchema from "./schema/provider";
import * as systemSchema from "./schema/system";
import * as templateSchema from "./schema/template";

export const schema = {
  ...authSchema,
  ...appSchema,
  ...contactSchema,
  ...providerSchema,
  ...messageSchema,
  ...templateSchema,
  ...systemSchema,
};

export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  },
  schema,
});

export type DB = typeof db;
