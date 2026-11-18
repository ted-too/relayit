ALTER TABLE "provider" DROP CONSTRAINT "provider_organization_id_organization_id_fkey";--> statement-breakpoint
ALTER TABLE "provider" DROP CONSTRAINT "provider_scope_organization_id_check";--> statement-breakpoint
ALTER TABLE "provider" DROP CONSTRAINT "provider_is_default_platform_only_check";--> statement-breakpoint
DROP INDEX "provider_platform_default_per_channel_uidx";--> statement-breakpoint
DROP INDEX "provider_scope_idx";--> statement-breakpoint
DROP INDEX "provider_organization_idx";--> statement-breakpoint
ALTER TABLE "provider" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "provider" DROP COLUMN "organization_id";--> statement-breakpoint
DROP TYPE "provider_scope";