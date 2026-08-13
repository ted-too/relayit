import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

const JOB_OUTBOX_STATUSES = ["pending", "published"] as const;

export const jobOutboxStatusEnum = pgEnum(
  "job_outbox_status",
  JOB_OUTBOX_STATUSES
);

export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("job").toString()),
    jobName: text("job_name").notNull(),
    payload: text("payload").notNull(),
    delayUntil: timestamp("delay_until"),
    status: jobOutboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: text("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at"),
    lastError: text("last_error"),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("job_outbox_pending_created_idx").on(table.status, table.createdAt),
    index("job_outbox_claim_expires_idx").on(
      table.status,
      table.claimExpiresAt
    ),
  ]
);
