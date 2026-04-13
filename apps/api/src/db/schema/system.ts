import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ENCRYPTION_VERSION_KEY = "encryption_version";

/**
 * System configuration table for tracking encryption versions and other system state
 */
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemConfig = typeof systemConfig.$inferSelect;

/**
 * Migration status tracking for encryption key rotations
 */
export const encryptionMigration = pgTable("encryption_migration", {
  id: text("id").primaryKey(),
  fromVersion: text("from_version").notNull(),
  toVersion: text("to_version").notNull(),
  status: text("status", {
    enum: ["pending", "in_progress", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  totalRecords: text("total_records"), // Store as text to handle large numbers
  migratedRecords: text("migrated_records").default("0"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type EncryptionMigration = typeof encryptionMigration.$inferSelect;
