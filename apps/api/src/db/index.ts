import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./schema/auth";
import * as coreSchema from "./schema/core";

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
