ALTER TABLE "webhook_event_delivery" ADD COLUMN "attempts_in_run" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD COLUMN "replay_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD COLUMN "claim_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
CREATE INDEX "webhook_event_delivery_claim_idx" ON "webhook_event_delivery" ("status","claim_expires_at");