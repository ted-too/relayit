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

export type Transaction = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => any
  ? T
  : never;

export * from "./crypto";
export * from "./message-ops";
export * from "./redis";
export type { ParsedApiKey, Project, ProjectDetails } from "./schema/auth";
export type {
  Message,
  NotificationProvider,
  ProjectProviderAssociation,
} from "./schema/core";
