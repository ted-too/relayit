ALTER TABLE "email_dns_record" ADD COLUMN "owner" text;--> statement-breakpoint
CREATE INDEX "email_dns_record_owner_idx" ON "email_dns_record" ("owner");