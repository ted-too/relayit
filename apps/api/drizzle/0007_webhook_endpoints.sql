CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'held', 'delivered', 'dead_letter');--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"idempotency_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_event_id" text NOT NULL,
	"webhook_endpoint_id" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD CONSTRAINT "webhook_event_delivery_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_delivery" ADD CONSTRAINT "webhook_event_delivery_webhook_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_idx" ON "webhook_endpoint" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_enabled_idx" ON "webhook_endpoint" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_idempotency_uidx" ON "webhook_event" USING btree ("idempotency_id");--> statement-breakpoint
CREATE INDEX "webhook_event_organization_created_idx" ON "webhook_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_type_idx" ON "webhook_event" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_delivery_event_endpoint_uidx" ON "webhook_event_delivery" USING btree ("webhook_event_id","webhook_endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_event_delivery_status_next_idx" ON "webhook_event_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_event_delivery_endpoint_idx" ON "webhook_event_delivery" USING btree ("webhook_endpoint_id");
