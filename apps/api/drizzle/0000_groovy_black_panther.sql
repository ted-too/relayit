CREATE TYPE "public"."action_type" AS ENUM('send_message');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('api');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('api', 'template');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'processing', 'sent', 'failed', 'delivered', 'malformed');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('aws');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('opted_out', 'subscribed', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('transactional');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
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
CREATE TABLE "apikey_organization" (
	"id" text PRIMARY KEY NOT NULL,
	"apikey_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"normalized_email" text,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_normalized_email_unique" UNIQUE("normalized_email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"external_identifiers" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "contact_identifier" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"identifier" text NOT NULL,
	"is_primary" boolean DEFAULT false,
	"marketing_status" "subscription_status" DEFAULT 'subscribed',
	"marketing_status_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"app_slug" text,
	"api_key_id" text,
	"contact_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"payload" jsonb NOT NULL,
	"source" "message_source" DEFAULT 'api' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_event" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"status" "message_status" NOT NULL,
	"attempt_number" integer NOT NULL,
	"identity_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"response_time_ms" integer,
	"retryable" boolean DEFAULT true,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"template_props" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_type" "channel" NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"name" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_credential_id" text NOT NULL,
	"identifier" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encryption_migration" (
	"id" text PRIMARY KEY NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_records" text,
	"migrated_records" text DEFAULT '0',
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" "template_category" DEFAULT 'transactional',
	"status" "template_status" DEFAULT 'draft',
	"current_version_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "template_channel_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_version_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey_organization" ADD CONSTRAINT "apikey_organization_apikey_id_apikey_id_fk" FOREIGN KEY ("apikey_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey_organization" ADD CONSTRAINT "apikey_organization_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifier" ADD CONSTRAINT "contact_identifier_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_event" ADD CONSTRAINT "message_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_event" ADD CONSTRAINT "message_event_identity_id_provider_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."provider_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_identity" ADD CONSTRAINT "provider_identity_provider_credential_id_provider_credential_id_fk" FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_channel_version" ADD CONSTRAINT "template_channel_version_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_organization_idx" ON "contact" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identifier_contact_channel_primary_unique_idx" ON "contact_identifier" USING btree ("contact_id","channel","is_primary") WHERE "contact_identifier"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identifier_channel_identifier_unique_idx" ON "contact_identifier" USING btree ("channel","identifier");--> statement-breakpoint
CREATE INDEX "contact_identifier_contact_idx" ON "contact_identifier" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_identifier_channel_idx" ON "contact_identifier" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "contact_identifier_identifier_idx" ON "contact_identifier" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "contact_identifier_primary_idx" ON "contact_identifier" USING btree ("is_primary");--> statement-breakpoint
CREATE INDEX "contact_identifier_marketing_status_idx" ON "contact_identifier" USING btree ("marketing_status");--> statement-breakpoint
CREATE INDEX "message_api_key_idx" ON "message" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "message_contact_idx" ON "message" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "message_channel_idx" ON "message" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "message_source_idx" ON "message" USING btree ("source");--> statement-breakpoint
CREATE INDEX "message_app_slug_idx" ON "message" USING btree ("app_slug");--> statement-breakpoint
CREATE INDEX "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_event_message_idx" ON "message_event" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_event_attempt_idx" ON "message_event" USING btree ("message_id","attempt_number");--> statement-breakpoint
CREATE INDEX "message_event_status_idx" ON "message_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "message_event_identity_idx" ON "message_event" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "message_event_started_at_idx" ON "message_event" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "message_event_response_time_idx" ON "message_event" USING btree ("response_time_ms");--> statement-breakpoint
CREATE INDEX "message_template_message_idx" ON "message_template" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_template_version_idx" ON "message_template" USING btree ("template_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credential_org_channel_default_unique_idx" ON "provider_credential" USING btree ("organization_id","channel_type","is_default") WHERE "provider_credential"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credential_org_channel_priority_unique_idx" ON "provider_credential" USING btree ("organization_id","channel_type","priority");--> statement-breakpoint
CREATE INDEX "provider_credential_organization_idx" ON "provider_credential" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_credential_channel_type_idx" ON "provider_credential" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "provider_credential_priority_idx" ON "provider_credential" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "provider_credential_active_idx" ON "provider_credential" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_identity_provider_default_unique_idx" ON "provider_identity" USING btree ("provider_credential_id","is_default") WHERE "provider_identity"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_identity_provider_identifier_unique_idx" ON "provider_identity" USING btree ("provider_credential_id","identifier");--> statement-breakpoint
CREATE INDEX "provider_identity_provider_idx" ON "provider_identity" USING btree ("provider_credential_id");--> statement-breakpoint
CREATE INDEX "provider_identity_identifier_idx" ON "provider_identity" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "provider_identity_default_idx" ON "provider_identity" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "provider_identity_active_idx" ON "provider_identity" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "template_org_slug_unique_idx" ON "template" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "template_organization_idx" ON "template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_status_idx" ON "template" USING btree ("status");--> statement-breakpoint
CREATE INDEX "template_category_idx" ON "template" USING btree ("category");--> statement-breakpoint
CREATE INDEX "template_current_version_idx" ON "template" USING btree ("current_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_channel_version_unique_idx" ON "template_channel_version" USING btree ("template_version_id","channel");--> statement-breakpoint
CREATE INDEX "template_channel_version_template_idx" ON "template_channel_version" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "template_channel_version_channel_idx" ON "template_channel_version" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_template_version_unique_idx" ON "template_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "template_version_template_idx" ON "template_version" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_version_created_at_idx" ON "template_version" USING btree ("created_at");