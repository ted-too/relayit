ALTER TABLE "message" ADD COLUMN "app_environment" text;--> statement-breakpoint
CREATE INDEX "message_app_environment_idx" ON "message" USING btree ("app_environment");