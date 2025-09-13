CREATE TABLE "template_channel_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_version_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "template_org_channel_slug_unique_idx";--> statement-breakpoint
DROP INDEX "template_channel_idx";--> statement-breakpoint
DROP INDEX "template_version_active_idx";--> statement-breakpoint
ALTER TABLE "template_channel_version" ADD CONSTRAINT "template_channel_version_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_channel_version_unique_idx" ON "template_channel_version" USING btree ("template_version_id","channel");--> statement-breakpoint
CREATE INDEX "template_channel_version_template_idx" ON "template_channel_version" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "template_channel_version_channel_idx" ON "template_channel_version" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "template_org_slug_unique_idx" ON "template" USING btree ("organization_id","slug");--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "channel";--> statement-breakpoint
ALTER TABLE "template_version" DROP COLUMN "is_active";