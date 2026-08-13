CREATE TABLE "message_idempotency" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"message_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "message_app_environment_idempotency_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "message_idempotency_organization_key_uidx" ON "message_idempotency" ("organization_id","key");--> statement-breakpoint
CREATE INDEX "message_idempotency_expires_at_idx" ON "message_idempotency" ("expires_at");--> statement-breakpoint
ALTER TABLE "message_idempotency" ADD CONSTRAINT "message_idempotency_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_idempotency" ADD CONSTRAINT "message_idempotency_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;