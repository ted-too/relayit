ALTER TABLE "message_event" RENAME COLUMN "from_identity_id" TO "identity_id";--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_from_identity_id_provider_identity_id_fk";
--> statement-breakpoint
ALTER TABLE "message_event" DROP CONSTRAINT "message_event_from_identity_id_provider_identity_id_fk";
--> statement-breakpoint
DROP INDEX "message_from_identity_idx";--> statement-breakpoint
ALTER TABLE "message_template" ALTER COLUMN "template_props" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message_event" ADD CONSTRAINT "message_event_identity_id_provider_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."provider_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_event_identity_idx" ON "message_event" USING btree ("identity_id");--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "from_identity_id";