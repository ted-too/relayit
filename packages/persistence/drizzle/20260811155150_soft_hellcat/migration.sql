CREATE TABLE "email_inbound" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"custom_domain_id" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"to_addresses" jsonb NOT NULL,
	"cc_addresses" jsonb NOT NULL,
	"subject" text,
	"message_id" text,
	"raw_object_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_domain" ADD COLUMN "inbound_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_inbound_org_provider_message_unique_idx" ON "email_inbound" ("organization_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "email_inbound_custom_domain_idx" ON "email_inbound" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_inbound_organization_idx" ON "email_inbound" ("organization_id");--> statement-breakpoint
CREATE INDEX "email_inbound_created_at_idx" ON "email_inbound" ("created_at");--> statement-breakpoint
ALTER TABLE "email_inbound" ADD CONSTRAINT "email_inbound_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_inbound" ADD CONSTRAINT "email_inbound_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;