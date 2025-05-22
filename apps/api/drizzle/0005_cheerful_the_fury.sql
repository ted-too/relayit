ALTER TABLE "project" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_provider_association" ADD COLUMN "priority" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credential" ADD COLUMN "org_default" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "project_provider_association" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "provider_credential" DROP COLUMN "is_active";