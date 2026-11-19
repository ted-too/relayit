ALTER TABLE "email_delivery" ADD COLUMN "stripped" jsonb;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "topic_id" text;--> statement-breakpoint
CREATE INDEX "message_topic_idx" ON "message" ("topic_id") WHERE "topic_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_topic_id_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE SET NULL;