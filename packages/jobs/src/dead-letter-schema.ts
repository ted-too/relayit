import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

export interface DeadLetterFailure {
  readonly code?: string;
  readonly details?: unknown;
  readonly message: string;
  readonly name: string;
}

const DEAD_LETTER_STATUSES = ["pending", "replayed", "discarded"] as const;

export const deadLetterStatusEnum = pgEnum(
  "job_dead_letter_status",
  DEAD_LETTER_STATUSES
);

export const jobDeadLetter = pgTable(
  "job_dead_letter",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("jdl").toString()),
    jobName: text("job_name").notNull(),
    originalStreamId: text("original_stream_id").notNull(),
    payload: text("payload").notNull(),
    wireVersion: integer("wire_version").notNull(),
    attempts: integer("attempts").notNull(),
    firstEnqueuedAt: timestamp("first_enqueued_at").notNull(),
    failedAt: timestamp("failed_at").notNull(),
    failure: jsonb("failure").$type<DeadLetterFailure>().notNull(),
    status: deadLetterStatusEnum("status").notNull().default("pending"),
    replayedAt: timestamp("replayed_at"),
    discardedAt: timestamp("discarded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("job_dead_letter_job_stream_uidx").on(
      table.jobName,
      table.originalStreamId
    ),
    index("job_dead_letter_status_failed_idx").on(table.status, table.failedAt),
  ]
);
