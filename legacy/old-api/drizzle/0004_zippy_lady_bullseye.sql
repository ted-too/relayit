ALTER TYPE "public"."message_status" ADD VALUE 'malformed';--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_provider_credential_id_provider_credential_id_fk";
--> statement-breakpoint
DROP INDEX "message_credential_idx";--> statement-breakpoint
ALTER TABLE "message_event" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "project_provider_association_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_project_provider_association_id_project_provider_association_id_fk" FOREIGN KEY ("project_provider_association_id") REFERENCES "public"."project_provider_association"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_project_provider_association_idx" ON "message" USING btree ("project_provider_association_id");--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "provider_credential_id";