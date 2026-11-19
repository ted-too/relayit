DROP INDEX "sandbox_domain_root_domain_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_domain_root_domain_unique_idx" ON "sandbox_domain" (lower("root_domain"));