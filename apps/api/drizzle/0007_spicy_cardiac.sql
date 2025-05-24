ALTER TABLE "message" DROP CONSTRAINT "message_project_provider_association_id_project_provider_association_id_fk";
--> statement-breakpoint
DROP INDEX "message_project_provider_association_idx";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "provider_type" "provider_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "project_provider_association_id";