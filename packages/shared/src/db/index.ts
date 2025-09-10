import { drizzle } from "drizzle-orm/node-postgres";
import * as appSchema from "./schema/app";
import * as authSchema from "./schema/auth";
import * as contactSchema from "./schema/contact";
import * as eventSchema from "./schema/event";
import * as messageSchema from "./schema/message";
import * as providerSchema from "./schema/provider";
import * as templateSchema from "./schema/template";

export const schema = {
  ...authSchema,
  ...appSchema,
  ...contactSchema,
  ...providerSchema,
  ...messageSchema,
  ...eventSchema,
  ...templateSchema,
};

export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  },
  schema,
});

export type * from "./schema/app";
export type * from "./schema/auth";
export type * from "./schema/contact";
export type * from "./schema/event";
export type * from "./schema/message";
export type * from "./schema/provider";
export type * from "./schema/template";
