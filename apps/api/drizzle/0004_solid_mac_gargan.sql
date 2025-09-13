ALTER TYPE "public"."message_source" ADD VALUE 'template';--> statement-breakpoint
ALTER TABLE "app" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app" CASCADE;--> statement-breakpoint
ALTER TABLE "message" RENAME COLUMN "app_id" TO "app_slug";--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "message_app_slug_idx" ON "message" USING btree ("app_slug");