CREATE TYPE "public"."user_channel_paused_reason" AS ENUM('abuse_detected', 'manual_admin_pause');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."message_purpose" AS ENUM('transactional', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."contact_suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TYPE "public"."contact_suppression_severity" AS ENUM('marketing', 'all');--> statement-breakpoint
CREATE TYPE "public"."provider_scope" AS ENUM('platform', 'project');--> statement-breakpoint
CREATE TYPE "public"."email_attachment_content_disposition" AS ENUM('inline', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."domain_ownership_verification_status" AS ENUM('not_verified', 'verified');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_event_kind" AS ENUM('accepted', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked');--> statement-breakpoint
CREATE TYPE "public"."email_dns_record_role" AS ENUM('direct', 'proxy', 'shared');--> statement-breakpoint
CREATE TYPE "public"."email_dns_record_status" AS ENUM('pending', 'active', 'missing');--> statement-breakpoint
CREATE TYPE "public"."dns_record_purpose" AS ENUM('dkim', 'spf', 'dmarc', 'ownership', 'mail_from_mx', 'mail_from_spf', 'dmarc_report_auth');--> statement-breakpoint
CREATE TYPE "public"."dns_record_type" AS ENUM('CNAME', 'TXT', 'MX');--> statement-breakpoint
CREATE TYPE "public"."domain_paused_reason" AS ENUM('bad_reputation', 'manual_admin_pause');--> statement-breakpoint
CREATE TYPE "public"."domain_verification_status" AS ENUM('not_verified', 'partially_verified', 'verified');--> statement-breakpoint
CREATE TYPE "public"."template_channel_engine" AS ENUM('primitive', 'reactEmail');--> statement-breakpoint
CREATE TYPE "public"."templating_workspace_kind" AS ENUM('reactEmail');--> statement-breakpoint
CREATE TYPE "public"."templating_workspace_source" AS ENUM('hosted', 'github');--> statement-breakpoint
CREATE TABLE "organization_app_environment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app" text,
	"environment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
CREATE TABLE "user_channel" (
	"user_id" text NOT NULL,
	"channel_type" "channel" NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "user_channel_paused_reason",
	"paused_at" timestamp,
	"limits" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_channel_user_id_channel_type_pk" PRIMARY KEY("user_id","channel_type")
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"topic_id" text NOT NULL,
	"template_id" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_channel_from" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"from" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_topic_unsubscribe" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_member" (
	"id" text PRIMARY KEY NOT NULL,
	"segment_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_type" "channel" NOT NULL,
	"vendor_id" text NOT NULL,
	"product_id" text NOT NULL,
	"scope" "provider_scope" DEFAULT 'project' NOT NULL,
	"organization_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"name" text,
	"credentials" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "provider_scope_organization_id_check" CHECK (("provider"."scope" = 'project' AND "provider"."organization_id" IS NOT NULL) OR ("provider"."scope" = 'platform' AND "provider"."organization_id" IS NULL)),
	CONSTRAINT "provider_is_default_platform_only_check" CHECK (("provider"."is_default" = false) OR ("provider"."scope" = 'platform'))
);
--> statement-breakpoint
CREATE TABLE "email_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"email_delivery_id" text NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"content_disposition" "email_attachment_content_disposition" NOT NULL,
	"content_id" text,
	"storage_key" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_attachment_inline_content_id_check" CHECK ("email_attachment"."content_disposition" != 'inline' OR "email_attachment"."content_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "custom_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"fqdn" text NOT NULL,
	"dkim_selector" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dkim_private_key" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified' NOT NULL,
	"provider" text DEFAULT 'unknown' NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "domain_paused_reason",
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_domain" (
	"organization_id" text NOT NULL,
	"custom_domain_id" text NOT NULL,
	"ownership_verification_status" "domain_ownership_verification_status" DEFAULT 'not_verified' NOT NULL,
	"ownership_token" text NOT NULL,
	"pending_provider_id" text,
	"ownership_last_checked_at" timestamp,
	"ownership_ever_verified_at" timestamp,
	"ownership_next_verify_at" timestamp,
	"ownership_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domain_organization_id_custom_domain_id_pk" PRIMARY KEY("organization_id","custom_domain_id")
);
--> statement-breakpoint
CREATE TABLE "email_delivery_event" (
	"id" text PRIMARY KEY NOT NULL,
	"email_delivery_id" text NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"provider_id" text,
	"kind" "email_delivery_event_kind" NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_event_sender_kind_check" CHECK (("email_delivery_event"."custom_domain_id" IS NOT NULL) <> ("email_delivery_event"."sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"from" jsonb NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb,
	"bcc" jsonb,
	"reply_to" jsonb,
	"subject" text NOT NULL,
	"html" text,
	"text" text,
	"headers" jsonb,
	"provider_id" text,
	"provider_message_id" text,
	"error" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "email_delivery_body_present_check" CHECK ("email_delivery"."html" IS NOT NULL OR "email_delivery"."text" IS NOT NULL),
	CONSTRAINT "email_delivery_sender_kind_check" CHECK (("email_delivery"."custom_domain_id" IS NOT NULL) <> ("email_delivery"."sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "dmarc_report" (
	"id" text PRIMARY KEY NOT NULL,
	"custom_domain_id" text NOT NULL,
	"reporter_org_name" text NOT NULL,
	"external_report_id" text NOT NULL,
	"date_range_begin" timestamp NOT NULL,
	"date_range_end" timestamp NOT NULL,
	"policy_published" jsonb,
	"raw_object_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmarc_report_row" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"source_ip" text NOT NULL,
	"count" integer NOT NULL,
	"disposition" text NOT NULL,
	"dkim_result" text NOT NULL,
	"spf_result" text NOT NULL,
	"dkim_aligned" boolean NOT NULL,
	"spf_aligned" boolean NOT NULL,
	"header_from" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_dns_record" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "email_dns_record_role" NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"purpose" "dns_record_purpose" NOT NULL,
	"record_type" "dns_record_type" NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"cloudflare_zone_id" text,
	"cloudflare_record_id" text,
	"status" "email_dns_record_status" DEFAULT 'pending' NOT NULL,
	"priority" integer,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_dns_record_scope_check" CHECK (("email_dns_record"."role" = 'shared' AND "email_dns_record"."custom_domain_id" IS NULL AND "email_dns_record"."sandbox_domain_id" IS NULL) OR ("email_dns_record"."role" <> 'shared' AND (("email_dns_record"."custom_domain_id" IS NOT NULL) <> ("email_dns_record"."sandbox_domain_id" IS NOT NULL)))),
	CONSTRAINT "email_dns_record_cloudflare_pairing_check" CHECK (("email_dns_record"."cloudflare_zone_id" IS NULL) = ("email_dns_record"."cloudflare_record_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "email_domain_provider_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"provider_id" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified' NOT NULL,
	"provider_data" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"failover_eligible" boolean DEFAULT true NOT NULL,
	"failover_priority" integer DEFAULT 100 NOT NULL,
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_domain_provider_identity_domain_kind_check" CHECK (("email_domain_provider_identity"."custom_domain_id" IS NOT NULL) <> ("email_domain_provider_identity"."sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sandbox_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"root_domain" text NOT NULL,
	"dkim_selector" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dkim_private_key" text NOT NULL,
	"cloudflare_zone_id" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "domain_paused_reason",
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_channel_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"engine" "template_channel_engine" NOT NULL,
	"content" jsonb,
	"variables" jsonb,
	"workspace_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "template_channel_variant_engine_payload_check" CHECK ((
        "template_channel_variant"."engine" = 'primitive'
        AND "template_channel_variant"."workspace_entry_id" IS NULL
        AND "template_channel_variant"."content" IS NOT NULL
      ) OR (
        "template_channel_variant"."engine" = 'reactEmail'
        AND "template_channel_variant"."content" IS NULL
        AND "template_channel_variant"."variables" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "templating_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "templating_workspace_kind" NOT NULL,
	"source" "templating_workspace_source" DEFAULT 'hosted' NOT NULL,
	"github_repository" text,
	"github_track_branch" text,
	"last_build_at" timestamp,
	"last_build_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "templating_workspace_source_fields_check" CHECK ((
        "templating_workspace"."source" = 'hosted'
        AND "templating_workspace"."github_repository" IS NULL
        AND "templating_workspace"."github_track_branch" IS NULL
      ) OR (
        "templating_workspace"."source" = 'github'
        AND "templating_workspace"."github_repository" IS NOT NULL
        AND "templating_workspace"."github_track_branch" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "templating_workspace_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"artifact_storage_key" text,
	"artifact_commit_sha" text,
	"inferred_props" jsonb,
	"built_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templating_workspace_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"sha" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- === Drop redesigned/rebuilt tables (keep contact_identifier + message until backfill) ===
ALTER TABLE "verification" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_event" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_template" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_credential" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_identity" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_channel_version" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_version" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "verification" CASCADE;--> statement-breakpoint
DROP TABLE "message_event" CASCADE;--> statement-breakpoint
DROP TABLE "message_template" CASCADE;--> statement-breakpoint
DROP TABLE "provider_credential" CASCADE;--> statement-breakpoint
DROP TABLE "provider_identity" CASCADE;--> statement-breakpoint
DROP TABLE "template_channel_version" CASCADE;--> statement-breakpoint
DROP TABLE "template_version" CASCADE;--> statement-breakpoint
ALTER TABLE "contact" DROP CONSTRAINT "contact_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_api_key_id_apikey_id_fk";
--> statement-breakpoint
DROP INDEX "contact_organization_idx";--> statement-breakpoint
DROP INDEX "message_api_key_idx";--> statement-breakpoint
DROP INDEX "message_contact_idx";--> statement-breakpoint
DROP INDEX "message_channel_idx";--> statement-breakpoint
DROP INDEX "message_source_idx";--> statement-breakpoint
DROP INDEX "message_app_slug_idx";--> statement-breakpoint
DROP INDEX "message_app_environment_idx";--> statement-breakpoint
DROP INDEX "message_created_at_idx";--> statement-breakpoint
DROP INDEX "template_org_slug_unique_idx";--> statement-breakpoint
DROP INDEX "template_status_idx";--> statement-breakpoint
DROP INDEX "template_category_idx";--> statement-breakpoint
DROP INDEX "template_current_version_idx";--> statement-breakpoint
-- === Additive column changes on retained tables (nullable first; backfilled below) ===
ALTER TABLE "organization" ADD COLUMN "sandbox_domain_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_user_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "limit_organizations" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "limit_retention" integer;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "organization_app_environment_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "properties" jsonb;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "unsubscribed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "suppression_reason" "contact_suppression_reason";--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "suppression_severity" "contact_suppression_severity";--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "suppressed_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "organization_app_environment_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "purpose" "message_purpose";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
-- === Backfill (from drizzle-backup/0005 + 0006; adapted for post-0005_lean_tenebrous) ===
-- Reconstruct app environments from historical message (app_slug, app_environment)
-- pairs, plus a default (null app / null environment) per org. Ids are derived
-- deterministically from (org, app, env) so the contact backfill below can resolve
-- the same row. Blank app/environment values are normalized to null.
INSERT INTO "organization_app_environment" ("id", "organization_id", "app", "environment", "created_at", "updated_at")
SELECT
	'oenv_' || md5(e."organization_id" || '|' || coalesce(e."app", '') || '|' || coalesce(e."environment", '')),
	e."organization_id", e."app", e."environment", now(), now()
FROM (
	SELECT DISTINCT
		c."organization_id" AS "organization_id",
		nullif(trim(m."app_slug"), '') AS "app",
		nullif(trim(m."app_environment"), '') AS "environment"
	FROM "message" m
	JOIN "contact" c ON c."id" = m."contact_id"
	UNION
	SELECT o."id", NULL, NULL FROM "organization" o
) e;--> statement-breakpoint
-- Move contacts onto an app environment inferred from their most recent message
-- (contacts with no messages fall back to the org's null/null default). Also lifts
-- the primary email + marketing status out of contact_identifier and splits the
-- legacy single `name` into first/last on the first whitespace.
UPDATE "contact" c SET
	"organization_app_environment_id" = 'oenv_' || md5(c."organization_id" || '|' || coalesce(sub."app", '') || '|' || coalesce(sub."environment", '')),
	"email" = sub."identifier",
	"first_name" = split_part(nullif(trim(c."name"), ''), ' ', 1),
	"last_name" = nullif(trim(substring(nullif(trim(c."name"), '') from '\s(.*)$')), ''),
	"unsubscribed" = (sub."marketing_status" IS DISTINCT FROM 'subscribed')
FROM (
	SELECT
		ci."contact_id",
		ci."identifier",
		ci."marketing_status",
		env."app",
		env."environment"
	FROM (
		SELECT DISTINCT ON ("contact_id") "contact_id", "identifier", "marketing_status"
		FROM "contact_identifier"
		WHERE "channel" = 'email'
		ORDER BY "contact_id", "is_primary" DESC, "created_at" ASC
	) ci
	LEFT JOIN LATERAL (
		SELECT nullif(trim(m."app_slug"), '') AS "app", nullif(trim(m."app_environment"), '') AS "environment"
		FROM "message" m
		WHERE m."contact_id" = ci."contact_id"
		ORDER BY m."created_at" DESC
		LIMIT 1
	) env ON true
) sub
WHERE sub."contact_id" = c."id";--> statement-breakpoint
-- Existing users predate the admin plugin's role field; seed them with the default role.
UPDATE "user" SET "role" = 'user' WHERE "role" IS NULL;--> statement-breakpoint
-- Normalize org-scoped API keys left as config_id='default' by 0005_lean_tenebrous.
UPDATE "apikey" a SET "config_id" = 'org-keys'
FROM "organization" o
WHERE a."reference_id" = o."id"
	AND a."config_id" IN ('default', 'org-keys');--> statement-breakpoint
-- Backfill org API key metadata for keys migrated without createdBy/end.
-- `end` is a placeholder; the stored key is hashed so the real suffix is not recoverable.
UPDATE "apikey" a
SET "metadata" = json_build_object(
	'createdBy', m."user_id",
	'end', 'xxxxxx'
)::text
FROM "member" m
WHERE a."config_id" = 'org-keys'
	AND m."organization_id" = a."reference_id"
	AND m."role" = 'owner'
	AND (
		a."metadata" IS NULL
		OR trim(a."metadata") IN ('', 'null')
		OR NOT (a."metadata"::jsonb ? 'createdBy')
	);--> statement-breakpoint
UPDATE "contact" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
-- Drop contacts that have no email identifier (cannot satisfy NOT NULL email).
DELETE FROM "contact" WHERE "email" IS NULL;--> statement-breakpoint
-- Deduplicate contacts that would violate (app_env, email) uniqueness; keep oldest.
DELETE FROM "contact"
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (
			PARTITION BY "organization_app_environment_id", "email"
			ORDER BY "created_at" ASC, "id" ASC
		) AS "rn"
		FROM "contact"
		WHERE "email" IS NOT NULL
	) d
	WHERE d."rn" > 1
);--> statement-breakpoint
-- Message history is not portable into Delivery-owned events; drop it after using
-- app/env pairs above for contact placement.
DELETE FROM "message";--> statement-breakpoint
-- Legacy templates are react-email source blobs. The new model needs a published
-- Email Workspace artifact before a Template is pickable/sendable — not scaffoldable
-- from SQL alone — so drop catalog rows rather than leave unusable shells.
DELETE FROM "template";--> statement-breakpoint
-- === Finalize retained-table constraints now that data is populated ===
ALTER TABLE "contact" ALTER COLUMN "organization_app_environment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "organization_app_environment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "purpose" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_contact_id_contact_id_fk";
--> statement-breakpoint
ALTER TABLE "contact_identifier" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "contact_identifier" CASCADE;--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "external_identifiers";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "app_slug";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "app_environment";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "api_key_id";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "contact_id";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "channel";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "payload";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "current_version_id";--> statement-breakpoint
ALTER TABLE "organization_app_environment" ADD CONSTRAINT "organization_app_environment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel" ADD CONSTRAINT "user_channel_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_channel_from" ADD CONSTRAINT "campaign_channel_from_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_topic_unsubscribe" ADD CONSTRAINT "contact_topic_unsubscribe_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_topic_unsubscribe" ADD CONSTRAINT "contact_topic_unsubscribe_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_member" ADD CONSTRAINT "segment_member_segment_id_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_member" ADD CONSTRAINT "segment_member_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_email_delivery_id_email_delivery_id_fk" FOREIGN KEY ("email_delivery_id") REFERENCES "public"."email_delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_email_delivery_id_email_delivery_id_fk" FOREIGN KEY ("email_delivery_id") REFERENCES "public"."email_delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_sandbox_domain_id_sandbox_domain_id_fk" FOREIGN KEY ("sandbox_domain_id") REFERENCES "public"."sandbox_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_sandbox_domain_id_sandbox_domain_id_fk" FOREIGN KEY ("sandbox_domain_id") REFERENCES "public"."sandbox_domain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmarc_report" ADD CONSTRAINT "dmarc_report_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dmarc_report_row" ADD CONSTRAINT "dmarc_report_row_report_id_dmarc_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."dmarc_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_dns_record" ADD CONSTRAINT "email_dns_record_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_dns_record" ADD CONSTRAINT "email_dns_record_sandbox_domain_id_sandbox_domain_id_fk" FOREIGN KEY ("sandbox_domain_id") REFERENCES "public"."sandbox_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_custom_domain_id_custom_domain_id_fk" FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_sandbox_domain_id_sandbox_domain_id_fk" FOREIGN KEY ("sandbox_domain_id") REFERENCES "public"."sandbox_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_channel_variant" ADD CONSTRAINT "template_channel_variant_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_channel_variant" ADD CONSTRAINT "template_channel_variant_workspace_entry_id_templating_workspace_entry_id_fk" FOREIGN KEY ("workspace_entry_id") REFERENCES "public"."templating_workspace_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templating_workspace" ADD CONSTRAINT "templating_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templating_workspace_entry" ADD CONSTRAINT "templating_workspace_entry_workspace_id_templating_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."templating_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templating_workspace_ref" ADD CONSTRAINT "templating_workspace_ref_workspace_id_templating_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."templating_workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_app_environment_organization_idx" ON "organization_app_environment" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_app_environment_org_app_env_unique_idx" ON "organization_app_environment" USING btree ("organization_id",coalesce("app", ''),coalesce("environment", ''));--> statement-breakpoint
CREATE INDEX "subscription_reference_id_idx" ON "subscription" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "user_channel_user_idx" ON "user_channel" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campaign_organization_idx" ON "campaign" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "campaign_topic_idx" ON "campaign" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "campaign_template_idx" ON "campaign" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "campaign_archived_at_idx" ON "campaign" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "campaign_organization_name_idx" ON "campaign" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_channel_from_campaign_channel_uidx" ON "campaign_channel_from" USING btree ("campaign_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_topic_unsubscribe_uidx" ON "contact_topic_unsubscribe" USING btree ("contact_id","topic_id");--> statement-breakpoint
CREATE INDEX "contact_topic_unsubscribe_topic_idx" ON "contact_topic_unsubscribe" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "segment_organization_idx" ON "segment" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_organization_name_uidx" ON "segment" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_member_segment_contact_uidx" ON "segment_member" USING btree ("segment_id","contact_id");--> statement-breakpoint
CREATE INDEX "segment_member_contact_idx" ON "segment_member" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "topic_organization_idx" ON "topic" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_organization_name_uidx" ON "topic" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_platform_default_per_channel_uidx" ON "provider" USING btree ("channel_type") WHERE "provider"."scope" = 'platform' AND "provider"."is_default" = true;--> statement-breakpoint
CREATE INDEX "provider_channel_type_idx" ON "provider" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "provider_scope_idx" ON "provider" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "provider_organization_idx" ON "provider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_vendor_product_idx" ON "provider" USING btree ("vendor_id","product_id");--> statement-breakpoint
CREATE INDEX "email_attachment_delivery_idx" ON "email_attachment" USING btree ("email_delivery_id");--> statement-breakpoint
CREATE INDEX "email_attachment_expires_at_idx" ON "email_attachment" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_fqdn_unique_idx" ON "custom_domain" USING btree ("fqdn");--> statement-breakpoint
CREATE INDEX "custom_domain_fqdn_idx" ON "custom_domain" USING btree ("fqdn");--> statement-breakpoint
CREATE INDEX "custom_domain_status_idx" ON "custom_domain" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "custom_domain_next_verify_at_idx" ON "custom_domain" USING btree ("next_verify_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domain_ownership_token_unique_idx" ON "organization_domain" USING btree ("ownership_token");--> statement-breakpoint
CREATE INDEX "organization_domain_organization_idx" ON "organization_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_domain_custom_domain_idx" ON "organization_domain" USING btree ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "organization_domain_ownership_next_verify_at_idx" ON "organization_domain" USING btree ("ownership_next_verify_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_delivery_idx" ON "email_delivery_event" USING btree ("email_delivery_id");--> statement-breakpoint
CREATE INDEX "email_delivery_event_kind_idx" ON "email_delivery_event" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "email_delivery_event_custom_domain_kind_created_idx" ON "email_delivery_event" USING btree ("custom_domain_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_sandbox_domain_kind_created_idx" ON "email_delivery_event" USING btree ("sandbox_domain_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_provider_kind_created_idx" ON "email_delivery_event" USING btree ("provider_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_message_idx" ON "email_delivery" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_status_idx" ON "email_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_delivery_custom_domain_idx" ON "email_delivery" USING btree ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_delivery_sandbox_domain_idx" ON "email_delivery" USING btree ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "email_delivery_provider_idx" ON "email_delivery" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_id_unique_idx" ON "email_delivery" USING btree ("provider_message_id") WHERE "email_delivery"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dmarc_report_domain_external_id_unique_idx" ON "dmarc_report" USING btree ("custom_domain_id","external_report_id");--> statement-breakpoint
CREATE INDEX "dmarc_report_custom_domain_idx" ON "dmarc_report" USING btree ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "dmarc_report_date_range_idx" ON "dmarc_report" USING btree ("date_range_begin","date_range_end");--> statement-breakpoint
CREATE INDEX "dmarc_report_row_report_idx" ON "dmarc_report_row" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_custom_role_purpose_unique_idx" ON "email_dns_record" USING btree ("custom_domain_id","role","purpose") WHERE "email_dns_record"."custom_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_sandbox_role_purpose_unique_idx" ON "email_dns_record" USING btree ("sandbox_domain_id","role","purpose") WHERE "email_dns_record"."sandbox_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_shared_purpose_unique_idx" ON "email_dns_record" USING btree ("purpose") WHERE "email_dns_record"."role" = 'shared';--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_cloudflare_record_unique_idx" ON "email_dns_record" USING btree ("cloudflare_zone_id","cloudflare_record_id") WHERE "email_dns_record"."cloudflare_record_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_dns_record_custom_domain_idx" ON "email_dns_record" USING btree ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_dns_record_sandbox_domain_idx" ON "email_dns_record" USING btree ("sandbox_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_domain_provider_identity_custom_provider_unique_idx" ON "email_domain_provider_identity" USING btree ("custom_domain_id","provider_id") WHERE "email_domain_provider_identity"."custom_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_domain_provider_identity_sandbox_provider_unique_idx" ON "email_domain_provider_identity" USING btree ("sandbox_domain_id","provider_id") WHERE "email_domain_provider_identity"."sandbox_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_custom_domain_idx" ON "email_domain_provider_identity" USING btree ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_sandbox_domain_idx" ON "email_domain_provider_identity" USING btree ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_provider_idx" ON "email_domain_provider_identity" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_next_verify_at_idx" ON "email_domain_provider_identity" USING btree ("next_verify_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_domain_root_domain_unique_idx" ON "sandbox_domain" USING btree ("root_domain");--> statement-breakpoint
CREATE INDEX "sandbox_domain_status_idx" ON "sandbox_domain" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "sandbox_domain_next_verify_at_idx" ON "sandbox_domain" USING btree ("next_verify_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_channel_variant_template_channel_uidx" ON "template_channel_variant" USING btree ("template_id","channel");--> statement-breakpoint
CREATE INDEX "template_channel_variant_workspace_entry_idx" ON "template_channel_variant" USING btree ("workspace_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_organization_kind_hosted_uidx" ON "templating_workspace" USING btree ("organization_id","kind") WHERE "templating_workspace"."source" = 'hosted';--> statement-breakpoint
CREATE INDEX "templating_workspace_organization_idx" ON "templating_workspace" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "templating_workspace_entry_workspace_idx" ON "templating_workspace_entry" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "templating_workspace_entry_deleted_at_idx" ON "templating_workspace_entry" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_entry_workspace_path_active_uidx" ON "templating_workspace_entry" USING btree ("workspace_id","path") WHERE "templating_workspace_entry"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_ref_workspace_name_uidx" ON "templating_workspace_ref" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "templating_workspace_ref_workspace_idx" ON "templating_workspace_ref" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_sandbox_domain_id_sandbox_domain_id_fk" FOREIGN KEY ("sandbox_domain_id") REFERENCES "public"."sandbox_domain"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_billing_user_id_user_id_fk" FOREIGN KEY ("billing_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_app_environment_id_organization_app_environment_id_fk" FOREIGN KEY ("organization_app_environment_id") REFERENCES "public"."organization_app_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_organization_app_environment_id_organization_app_environment_id_fk" FOREIGN KEY ("organization_app_environment_id") REFERENCES "public"."organization_app_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_sandbox_domain_idx" ON "organization" USING btree ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "organization_billing_user_idx" ON "organization" USING btree ("billing_user_id");--> statement-breakpoint
CREATE INDEX "contact_organization_app_environment_idx" ON "contact" USING btree ("organization_app_environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_app_env_email_unique_idx" ON "contact" USING btree ("organization_app_environment_id","email");--> statement-breakpoint
CREATE INDEX "contact_email_idx" ON "contact" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contact_properties_gin_idx" ON "contact" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "contact_unsubscribed_idx" ON "contact" USING btree ("unsubscribed");--> statement-breakpoint
CREATE INDEX "contact_suppression_reason_idx" ON "contact" USING btree ("suppression_reason");--> statement-breakpoint
CREATE INDEX "contact_suppression_severity_idx" ON "contact" USING btree ("suppression_severity");--> statement-breakpoint
CREATE INDEX "contact_deleted_at_idx" ON "contact" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "message_app_environment_created_idx" ON "message" USING btree ("organization_app_environment_id","created_at");--> statement-breakpoint
CREATE INDEX "message_template_idx" ON "message" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_app_environment_idempotency_uidx" ON "message" USING btree ("organization_app_environment_id","idempotency_key") WHERE "message"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "template_archived_at_idx" ON "template" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_organization_slug_active_uidx" ON "template" USING btree ("organization_id","slug") WHERE "template"."archived_at" IS NULL;--> statement-breakpoint
DROP TYPE "public"."action_type";--> statement-breakpoint
DROP TYPE "public"."event_source";--> statement-breakpoint
DROP TYPE "public"."message_source";--> statement-breakpoint
DROP TYPE "public"."message_status";--> statement-breakpoint
DROP TYPE "public"."provider_type";--> statement-breakpoint
DROP TYPE "public"."subscription_status";--> statement-breakpoint
DROP TYPE "public"."template_category";--> statement-breakpoint
DROP TYPE "public"."template_status";
