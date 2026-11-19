CREATE TABLE "removed_domain_identity" (
	"id" text PRIMARY KEY,
	"fqdn" text NOT NULL,
	"region" text,
	"dkim_selector" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "removed_domain_identity_fqdn_idx" ON "removed_domain_identity" ("fqdn");