CREATE TYPE "channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "contact_suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TYPE "contact_suppression_severity" AS ENUM('marketing', 'all');--> statement-breakpoint
CREATE TYPE "delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'canceled');--> statement-breakpoint
CREATE TYPE "dns_record_purpose" AS ENUM('dkim', 'spf', 'dmarc', 'ownership', 'mail_from_mx', 'mail_from_spf', 'dmarc_report_auth');--> statement-breakpoint
CREATE TYPE "dns_record_type" AS ENUM('CNAME', 'TXT', 'MX');--> statement-breakpoint
CREATE TYPE "domain_ownership_verification_status" AS ENUM('not_verified', 'verified');--> statement-breakpoint
CREATE TYPE "domain_paused_reason" AS ENUM('bad_reputation', 'manual_admin_pause');--> statement-breakpoint
CREATE TYPE "domain_verification_status" AS ENUM('not_verified', 'partially_verified', 'verified');--> statement-breakpoint
CREATE TYPE "email_attachment_content_disposition" AS ENUM('inline', 'attachment');--> statement-breakpoint
CREATE TYPE "email_delivery_event_kind" AS ENUM('accepted', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked');--> statement-breakpoint
CREATE TYPE "email_dns_record_role" AS ENUM('direct', 'proxy', 'shared');--> statement-breakpoint
CREATE TYPE "email_dns_record_status" AS ENUM('pending', 'active', 'missing');--> statement-breakpoint
CREATE TYPE "message_purpose" AS ENUM('transactional', 'marketing');--> statement-breakpoint
CREATE TYPE "provider_scope" AS ENUM('platform', 'project');--> statement-breakpoint
CREATE TYPE "template_channel_engine" AS ENUM('primitive', 'reactEmail');--> statement-breakpoint
CREATE TYPE "templating_workspace_kind" AS ENUM('reactEmail');--> statement-breakpoint
CREATE TYPE "templating_workspace_source" AS ENUM('hosted', 'github');--> statement-breakpoint
CREATE TYPE "user_channel_paused_reason" AS ENUM('abuse_detected', 'manual_admin_pause');--> statement-breakpoint
CREATE TYPE "webhook_delivery_status" AS ENUM('pending', 'held', 'delivered', 'dead_letter');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY,
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
	"id" text PRIMARY KEY,
	"campaign_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"from" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY,
	"organization_app_environment_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"properties" jsonb,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"suppression_reason" "contact_suppression_reason",
	"suppression_severity" "contact_suppression_severity",
	"suppressed_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_topic_unsubscribe" (
	"id" text PRIMARY KEY,
	"contact_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_domain" (
	"id" text PRIMARY KEY,
	"fqdn" text NOT NULL,
	"dkim_selector" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dkim_private_key" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified'::"domain_verification_status" NOT NULL,
	"provider" text DEFAULT 'unknown' NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "domain_paused_reason",
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dmarc_report" (
	"id" text PRIMARY KEY,
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
	"id" text PRIMARY KEY,
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
CREATE TABLE "email_attachment" (
	"id" text PRIMARY KEY,
	"email_delivery_id" text NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"content_disposition" "email_attachment_content_disposition" NOT NULL,
	"content_id" text,
	"storage_key" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_attachment_inline_content_id_check" CHECK ("content_disposition" != 'inline' OR "content_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY,
	"message_id" text NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"status" "delivery_status" DEFAULT 'queued'::"delivery_status" NOT NULL,
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
	CONSTRAINT "email_delivery_body_present_check" CHECK ("html" IS NOT NULL OR "text" IS NOT NULL),
	CONSTRAINT "email_delivery_sender_kind_check" CHECK (("custom_domain_id" IS NOT NULL) <> ("sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "email_delivery_event" (
	"id" text PRIMARY KEY,
	"email_delivery_id" text NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"provider_id" text,
	"kind" "email_delivery_event_kind" NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_event_sender_kind_check" CHECK (("custom_domain_id" IS NOT NULL) <> ("sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "email_dns_record" (
	"id" text PRIMARY KEY,
	"role" "email_dns_record_role" NOT NULL,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"purpose" "dns_record_purpose" NOT NULL,
	"record_type" "dns_record_type" NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"cloudflare_zone_id" text,
	"cloudflare_record_id" text,
	"status" "email_dns_record_status" DEFAULT 'pending'::"email_dns_record_status" NOT NULL,
	"priority" integer,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_dns_record_scope_check" CHECK (("role" = 'shared' AND "custom_domain_id" IS NULL AND "sandbox_domain_id" IS NULL) OR ("role" <> 'shared' AND (("custom_domain_id" IS NOT NULL) <> ("sandbox_domain_id" IS NOT NULL)))),
	CONSTRAINT "email_dns_record_cloudflare_pairing_check" CHECK (("cloudflare_zone_id" IS NULL) = ("cloudflare_record_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "email_domain_provider_identity" (
	"id" text PRIMARY KEY,
	"custom_domain_id" text,
	"sandbox_domain_id" text,
	"provider_id" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified'::"domain_verification_status" NOT NULL,
	"provider_data" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"failover_eligible" boolean DEFAULT true NOT NULL,
	"failover_priority" integer DEFAULT 100 NOT NULL,
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_domain_provider_identity_domain_kind_check" CHECK (("custom_domain_id" IS NOT NULL) <> ("sandbox_domain_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY,
	"organization_app_environment_id" text NOT NULL,
	"purpose" "message_purpose" NOT NULL,
	"template_id" text,
	"tags" jsonb,
	"idempotency_key" text,
	"scheduled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"metadata" text,
	"sandbox_domain_id" text,
	"billing_user_id" text
);
--> statement-breakpoint
CREATE TABLE "organization_app_environment" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"app" text,
	"environment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_domain" (
	"organization_id" text,
	"custom_domain_id" text,
	"ownership_verification_status" "domain_ownership_verification_status" DEFAULT 'not_verified'::"domain_ownership_verification_status" NOT NULL,
	"ownership_token" text NOT NULL,
	"pending_provider_id" text,
	"ownership_last_checked_at" timestamp,
	"ownership_ever_verified_at" timestamp,
	"ownership_next_verify_at" timestamp,
	"ownership_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domain_pkey" PRIMARY KEY("organization_id","custom_domain_id")
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" text PRIMARY KEY,
	"channel_type" "channel" NOT NULL,
	"vendor_id" text NOT NULL,
	"product_id" text NOT NULL,
	"scope" "provider_scope" DEFAULT 'project'::"provider_scope" NOT NULL,
	"organization_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"name" text,
	"credentials" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "provider_scope_organization_id_check" CHECK (("scope" = 'project' AND "organization_id" IS NOT NULL) OR ("scope" = 'platform' AND "organization_id" IS NULL)),
	CONSTRAINT "provider_is_default_platform_only_check" CHECK (("is_default" = false) OR ("scope" = 'platform'))
);
--> statement-breakpoint
CREATE TABLE "sandbox_domain" (
	"id" text PRIMARY KEY,
	"root_domain" text NOT NULL,
	"dkim_selector" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dkim_private_key" text NOT NULL,
	"cloudflare_zone_id" text NOT NULL,
	"verification_status" "domain_verification_status" DEFAULT 'not_verified'::"domain_verification_status" NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "domain_paused_reason",
	"last_checked_at" timestamp,
	"next_verify_at" timestamp,
	"verify_backoff_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_member" (
	"id" text PRIMARY KEY,
	"segment_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY,
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
CREATE TABLE "template" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_channel_variant" (
	"id" text PRIMARY KEY,
	"template_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"engine" "template_channel_engine" NOT NULL,
	"content" jsonb,
	"variables" jsonb,
	"workspace_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "template_channel_variant_engine_payload_check" CHECK ((
        "engine" = 'primitive'
        AND "workspace_entry_id" IS NULL
        AND "content" IS NOT NULL
      ) OR (
        "engine" = 'reactEmail'
        AND "variables" IS NULL
        AND "content" IS NOT NULL
        AND coalesce("content"->>'subject', '') <> ''
      ))
);
--> statement-breakpoint
CREATE TABLE "templating_workspace" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" "templating_workspace_kind" NOT NULL,
	"source" "templating_workspace_source" DEFAULT 'hosted'::"templating_workspace_source" NOT NULL,
	"github_repository" text,
	"github_track_branch" text,
	"last_build_at" timestamp,
	"last_build_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "templating_workspace_source_fields_check" CHECK ((
        "source" = 'hosted'
        AND "github_repository" IS NULL
        AND "github_track_branch" IS NULL
      ) OR (
        "source" = 'github'
        AND "github_repository" IS NOT NULL
        AND "github_track_branch" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "templating_workspace_entry" (
	"id" text PRIMARY KEY,
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
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"sha" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"stripe_customer_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"normalized_email" text UNIQUE,
	"limit_organizations" integer,
	"limit_retention" integer
);
--> statement-breakpoint
CREATE TABLE "user_channel" (
	"user_id" text,
	"channel_type" "channel",
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_reason" "user_channel_paused_reason",
	"paused_at" timestamp,
	"limits" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_channel_pkey" PRIMARY KEY("user_id","channel_type")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb DEFAULT '[]' NOT NULL,
	"tag_filter" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"signing_secret" text NOT NULL,
	"previous_signing_secret" text,
	"previous_secret_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"idempotency_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event_delivery" (
	"id" text PRIMARY KEY,
	"webhook_event_id" text NOT NULL,
	"webhook_endpoint_id" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending'::"webhook_delivery_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE INDEX "campaign_organization_idx" ON "campaign" ("organization_id");--> statement-breakpoint
CREATE INDEX "campaign_topic_idx" ON "campaign" ("topic_id");--> statement-breakpoint
CREATE INDEX "campaign_template_idx" ON "campaign" ("template_id");--> statement-breakpoint
CREATE INDEX "campaign_archived_at_idx" ON "campaign" ("archived_at");--> statement-breakpoint
CREATE INDEX "campaign_organization_name_idx" ON "campaign" ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_channel_from_campaign_channel_uidx" ON "campaign_channel_from" ("campaign_id","channel");--> statement-breakpoint
CREATE INDEX "contact_organization_app_environment_idx" ON "contact" ("organization_app_environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_app_env_email_unique_idx" ON "contact" ("organization_app_environment_id","email");--> statement-breakpoint
CREATE INDEX "contact_email_idx" ON "contact" ("email");--> statement-breakpoint
CREATE INDEX "contact_properties_gin_idx" ON "contact" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "contact_unsubscribed_idx" ON "contact" ("unsubscribed");--> statement-breakpoint
CREATE INDEX "contact_suppression_reason_idx" ON "contact" ("suppression_reason");--> statement-breakpoint
CREATE INDEX "contact_suppression_severity_idx" ON "contact" ("suppression_severity");--> statement-breakpoint
CREATE INDEX "contact_deleted_at_idx" ON "contact" ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_topic_unsubscribe_uidx" ON "contact_topic_unsubscribe" ("contact_id","topic_id");--> statement-breakpoint
CREATE INDEX "contact_topic_unsubscribe_topic_idx" ON "contact_topic_unsubscribe" ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_fqdn_unique_idx" ON "custom_domain" ("fqdn");--> statement-breakpoint
CREATE INDEX "custom_domain_fqdn_idx" ON "custom_domain" ("fqdn");--> statement-breakpoint
CREATE INDEX "custom_domain_status_idx" ON "custom_domain" ("verification_status");--> statement-breakpoint
CREATE INDEX "custom_domain_next_verify_at_idx" ON "custom_domain" ("next_verify_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dmarc_report_domain_external_id_unique_idx" ON "dmarc_report" ("custom_domain_id","external_report_id");--> statement-breakpoint
CREATE INDEX "dmarc_report_custom_domain_idx" ON "dmarc_report" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "dmarc_report_date_range_idx" ON "dmarc_report" ("date_range_begin","date_range_end");--> statement-breakpoint
CREATE INDEX "dmarc_report_row_report_idx" ON "dmarc_report_row" ("report_id");--> statement-breakpoint
CREATE INDEX "email_attachment_delivery_idx" ON "email_attachment" ("email_delivery_id");--> statement-breakpoint
CREATE INDEX "email_attachment_expires_at_idx" ON "email_attachment" ("expires_at");--> statement-breakpoint
CREATE INDEX "email_delivery_message_idx" ON "email_delivery" ("message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_status_idx" ON "email_delivery" ("status");--> statement-breakpoint
CREATE INDEX "email_delivery_custom_domain_idx" ON "email_delivery" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_delivery_sandbox_domain_idx" ON "email_delivery" ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "email_delivery_provider_idx" ON "email_delivery" ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_id_unique_idx" ON "email_delivery" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_delivery_event_delivery_idx" ON "email_delivery_event" ("email_delivery_id");--> statement-breakpoint
CREATE INDEX "email_delivery_event_kind_idx" ON "email_delivery_event" ("kind");--> statement-breakpoint
CREATE INDEX "email_delivery_event_custom_domain_kind_created_idx" ON "email_delivery_event" ("custom_domain_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_sandbox_domain_kind_created_idx" ON "email_delivery_event" ("sandbox_domain_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_provider_kind_created_idx" ON "email_delivery_event" ("provider_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_custom_role_purpose_unique_idx" ON "email_dns_record" ("custom_domain_id","role","purpose") WHERE "custom_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_sandbox_role_purpose_unique_idx" ON "email_dns_record" ("sandbox_domain_id","role","purpose") WHERE "sandbox_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_shared_purpose_unique_idx" ON "email_dns_record" ("purpose") WHERE "role" = 'shared';--> statement-breakpoint
CREATE UNIQUE INDEX "email_dns_record_cloudflare_record_unique_idx" ON "email_dns_record" ("cloudflare_zone_id","cloudflare_record_id") WHERE "cloudflare_record_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_dns_record_custom_domain_idx" ON "email_dns_record" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_dns_record_sandbox_domain_idx" ON "email_dns_record" ("sandbox_domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_domain_provider_identity_custom_provider_unique_idx" ON "email_domain_provider_identity" ("custom_domain_id","provider_id") WHERE "custom_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_domain_provider_identity_sandbox_provider_unique_idx" ON "email_domain_provider_identity" ("sandbox_domain_id","provider_id") WHERE "sandbox_domain_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_custom_domain_idx" ON "email_domain_provider_identity" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_sandbox_domain_idx" ON "email_domain_provider_identity" ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_provider_idx" ON "email_domain_provider_identity" ("provider_id");--> statement-breakpoint
CREATE INDEX "email_domain_provider_identity_next_verify_at_idx" ON "email_domain_provider_identity" ("next_verify_at");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" ("user_id");--> statement-breakpoint
CREATE INDEX "message_app_environment_created_idx" ON "message" ("organization_app_environment_id","created_at");--> statement-breakpoint
CREATE INDEX "message_template_idx" ON "message" ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_app_environment_idempotency_uidx" ON "message" ("organization_app_environment_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" ("slug");--> statement-breakpoint
CREATE INDEX "organization_sandbox_domain_idx" ON "organization" ("sandbox_domain_id");--> statement-breakpoint
CREATE INDEX "organization_billing_user_idx" ON "organization" ("billing_user_id");--> statement-breakpoint
CREATE INDEX "organization_app_environment_organization_idx" ON "organization_app_environment" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_app_environment_org_app_env_unique_idx" ON "organization_app_environment" ("organization_id",coalesce("app", ''),coalesce("environment", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domain_ownership_token_unique_idx" ON "organization_domain" ("ownership_token");--> statement-breakpoint
CREATE INDEX "organization_domain_organization_idx" ON "organization_domain" ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_domain_custom_domain_idx" ON "organization_domain" ("custom_domain_id");--> statement-breakpoint
CREATE INDEX "organization_domain_ownership_next_verify_at_idx" ON "organization_domain" ("ownership_next_verify_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_platform_default_per_channel_uidx" ON "provider" ("channel_type") WHERE "scope" = 'platform' AND "is_default" = true;--> statement-breakpoint
CREATE INDEX "provider_channel_type_idx" ON "provider" ("channel_type");--> statement-breakpoint
CREATE INDEX "provider_scope_idx" ON "provider" ("scope");--> statement-breakpoint
CREATE INDEX "provider_organization_idx" ON "provider" ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_vendor_product_idx" ON "provider" ("vendor_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_domain_root_domain_unique_idx" ON "sandbox_domain" ("root_domain");--> statement-breakpoint
CREATE INDEX "sandbox_domain_status_idx" ON "sandbox_domain" ("verification_status");--> statement-breakpoint
CREATE INDEX "sandbox_domain_next_verify_at_idx" ON "sandbox_domain" ("next_verify_at");--> statement-breakpoint
CREATE INDEX "segment_organization_idx" ON "segment" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_organization_name_uidx" ON "segment" ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_member_segment_contact_uidx" ON "segment_member" ("segment_id","contact_id");--> statement-breakpoint
CREATE INDEX "segment_member_contact_idx" ON "segment_member" ("contact_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_id_idx" ON "subscription" ("reference_id");--> statement-breakpoint
CREATE INDEX "template_organization_idx" ON "template" ("organization_id");--> statement-breakpoint
CREATE INDEX "template_archived_at_idx" ON "template" ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_organization_slug_active_uidx" ON "template" ("organization_id","slug") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "template_channel_variant_template_channel_uidx" ON "template_channel_variant" ("template_id","channel");--> statement-breakpoint
CREATE INDEX "template_channel_variant_workspace_entry_idx" ON "template_channel_variant" ("workspace_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_organization_kind_hosted_uidx" ON "templating_workspace" ("organization_id","kind") WHERE "source" = 'hosted';--> statement-breakpoint
CREATE INDEX "templating_workspace_organization_idx" ON "templating_workspace" ("organization_id");--> statement-breakpoint
CREATE INDEX "templating_workspace_entry_workspace_idx" ON "templating_workspace_entry" ("workspace_id");--> statement-breakpoint
CREATE INDEX "templating_workspace_entry_deleted_at_idx" ON "templating_workspace_entry" ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_entry_workspace_path_active_uidx" ON "templating_workspace_entry" ("workspace_id","path") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "templating_workspace_ref_workspace_name_uidx" ON "templating_workspace_ref" ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "templating_workspace_ref_workspace_idx" ON "templating_workspace_ref" ("workspace_id");--> statement-breakpoint
CREATE INDEX "topic_organization_idx" ON "topic" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_organization_name_uidx" ON "topic" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "user_channel_user_idx" ON "user_channel" ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_idx" ON "webhook_endpoint" ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_enabled_idx" ON "webhook_endpoint" ("organization_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_idempotency_uidx" ON "webhook_event" ("idempotency_id");--> statement-breakpoint
CREATE INDEX "webhook_event_organization_created_idx" ON "webhook_event" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_type_idx" ON "webhook_event" ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_delivery_event_endpoint_uidx" ON "webhook_event_delivery" ("webhook_event_id","webhook_endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_event_delivery_status_next_idx" ON "webhook_event_delivery" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_event_delivery_endpoint_idx" ON "webhook_event_delivery" ("webhook_endpoint_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_topic_id_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "campaign_channel_from" ADD CONSTRAINT "campaign_channel_from_campaign_id_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_yR8iEjwWGrjw_fkey" FOREIGN KEY ("organization_app_environment_id") REFERENCES "organization_app_environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_topic_unsubscribe" ADD CONSTRAINT "contact_topic_unsubscribe_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_topic_unsubscribe" ADD CONSTRAINT "contact_topic_unsubscribe_topic_id_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dmarc_report" ADD CONSTRAINT "dmarc_report_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dmarc_report_row" ADD CONSTRAINT "dmarc_report_row_report_id_dmarc_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "dmarc_report"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_email_delivery_id_email_delivery_id_fkey" FOREIGN KEY ("email_delivery_id") REFERENCES "email_delivery"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_sandbox_domain_id_sandbox_domain_id_fkey" FOREIGN KEY ("sandbox_domain_id") REFERENCES "sandbox_domain"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_provider_id_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_email_delivery_id_email_delivery_id_fkey" FOREIGN KEY ("email_delivery_id") REFERENCES "email_delivery"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_sandbox_domain_id_sandbox_domain_id_fkey" FOREIGN KEY ("sandbox_domain_id") REFERENCES "sandbox_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_delivery_event" ADD CONSTRAINT "email_delivery_event_provider_id_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_dns_record" ADD CONSTRAINT "email_dns_record_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_dns_record" ADD CONSTRAINT "email_dns_record_sandbox_domain_id_sandbox_domain_id_fkey" FOREIGN KEY ("sandbox_domain_id") REFERENCES "sandbox_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_V6KWLScfDwaG_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_MnAh49DhIU3U_fkey" FOREIGN KEY ("sandbox_domain_id") REFERENCES "sandbox_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_domain_provider_identity" ADD CONSTRAINT "email_domain_provider_identity_provider_id_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_yR8iEdHS1GCn_fkey" FOREIGN KEY ("organization_app_environment_id") REFERENCES "organization_app_environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_template_id_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_sandbox_domain_id_sandbox_domain_id_fkey" FOREIGN KEY ("sandbox_domain_id") REFERENCES "sandbox_domain"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_billing_user_id_user_id_fkey" FOREIGN KEY ("billing_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_app_environment" ADD CONSTRAINT "organization_app_environment_HVkdMfxFJGIn_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_domain" ADD CONSTRAINT "organization_domain_custom_domain_id_custom_domain_id_fkey" FOREIGN KEY ("custom_domain_id") REFERENCES "custom_domain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "segment_member" ADD CONSTRAINT "segment_member_segment_id_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "segment_member" ADD CONSTRAINT "segment_member_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "template_channel_variant" ADD CONSTRAINT "template_channel_variant_template_id_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "template_channel_variant" ADD CONSTRAINT "template_channel_variant_lKHVR9Ots4tG_fkey" FOREIGN KEY ("workspace_entry_id") REFERENCES "templating_workspace_entry"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "templating_workspace" ADD CONSTRAINT "templating_workspace_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "templating_workspace_entry" ADD CONSTRAINT "templating_workspace_entry_7xzyOgdoI9lM_fkey" FOREIGN KEY ("workspace_id") REFERENCES "templating_workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "templating_workspace_ref" ADD CONSTRAINT "templating_workspace_ref_D56bxbnUjs7H_fkey" FOREIGN KEY ("workspace_id") REFERENCES "templating_workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_channel" ADD CONSTRAINT "user_channel_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD CONSTRAINT "webhook_event_delivery_webhook_event_id_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD CONSTRAINT "webhook_event_delivery_P7egxXCP7VUl_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE;