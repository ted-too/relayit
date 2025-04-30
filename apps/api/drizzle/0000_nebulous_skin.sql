CREATE TYPE "public"."channel" AS ENUM('email', 'sms', 'whatsapp', 'discord');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'processing', 'sent', 'failed', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('ses', 'sns');--> statement-breakpoint
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_i_d" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "passkey_credential_i_d_unique" UNIQUE("credential_i_d")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
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
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text,
	"provider_credential_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"last_status_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "message_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"status" "message_status" NOT NULL,
	"details" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"channel_type" "channel" NOT NULL,
	"provider_type" "provider_type",
	"name" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"event_types" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_provider_credential_id_provider_credential_id_fk" FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credential"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_event" ADD CONSTRAINT "message_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slug_idx" ON "project" USING btree ("slug","organization_id");--> statement-breakpoint
CREATE INDEX "message_project_status_idx" ON "message" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "message_api_key_idx" ON "message" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "message_credential_idx" ON "message" USING btree ("provider_credential_id");--> statement-breakpoint
CREATE INDEX "message_event_message_idx" ON "message_event" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credential_organization_slug_idx" ON "provider_credential" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "provider_credential_organization_idx" ON "provider_credential" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_project_idx" ON "webhook_endpoint" USING btree ("project_id");