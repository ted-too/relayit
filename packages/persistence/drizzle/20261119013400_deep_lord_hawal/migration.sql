DROP INDEX "contact_organization_app_environment_idx";--> statement-breakpoint
DROP INDEX "contact_email_idx";--> statement-breakpoint
DROP INDEX "contact_app_env_lower_email_idx";--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_email_lower_check" CHECK ("email" = lower("email"));