ALTER TABLE "email_delivery" DROP CONSTRAINT "email_delivery_provider_id_provider_id_fkey";--> statement-breakpoint
ALTER TABLE "email_delivery_event" DROP CONSTRAINT "email_delivery_event_provider_id_provider_id_fkey";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP CONSTRAINT "email_domain_provider_identity_provider_id_provider_id_fkey";--> statement-breakpoint
DROP TABLE "provider";--> statement-breakpoint
DROP INDEX "email_delivery_provider_idx";--> statement-breakpoint
DROP INDEX "email_delivery_event_provider_kind_created_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_custom_provider_unique_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_sandbox_provider_unique_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_custom_domain_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_sandbox_domain_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_provider_idx";--> statement-breakpoint
DROP INDEX "email_domain_provider_identity_next_verify_at_idx";--> statement-breakpoint
ALTER TABLE "email_delivery" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "email_delivery_event" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "provider_data";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "failover_eligible";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "failover_priority";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "last_checked_at";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "next_verify_at";--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" DROP COLUMN "verify_backoff_level";--> statement-breakpoint
ALTER TABLE "organization_domain" DROP COLUMN "pending_provider_id";