CREATE TABLE "project_provider_association" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider_credential_id" text NOT NULL,
	"config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "provider_credential" DROP CONSTRAINT "provider_credential_project_id_project_id_fk";
--> statement-breakpoint
DROP INDEX "provider_credential_org_project_slug_unique_idx";--> statement-breakpoint
DROP INDEX "provider_credential_project_idx";--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "last_status_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "last_status_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_provider_association" ADD CONSTRAINT "project_provider_association_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_provider_association" ADD CONSTRAINT "project_provider_association_provider_credential_id_provider_credential_id_fk" FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proj_provider_assoc_unique_idx" ON "project_provider_association" USING btree ("project_id","provider_credential_id");--> statement-breakpoint
CREATE INDEX "ppa_project_idx" ON "project_provider_association" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ppa_provider_idx" ON "project_provider_association" USING btree ("provider_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credential_org_slug_unique_idx" ON "provider_credential" USING btree ("organization_id","slug");--> statement-breakpoint
ALTER TABLE "provider_credential" DROP COLUMN "project_id";