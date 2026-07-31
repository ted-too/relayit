-- reactEmail subject moves onto the Template variant (`content.subject`).
-- Webhook tables already exist from 0007_webhook_endpoints (no 0007 snapshot);
-- this migration only updates the engine payload check.
UPDATE "template_channel_variant"
SET "content" = jsonb_build_object('subject', 'Untitled')
WHERE "engine" = 'reactEmail'
  AND (
    "content" IS NULL
    OR coalesce("content"->>'subject', '') = ''
  );--> statement-breakpoint
ALTER TABLE "template_channel_variant" DROP CONSTRAINT "template_channel_variant_engine_payload_check";--> statement-breakpoint
ALTER TABLE "template_channel_variant" ADD CONSTRAINT "template_channel_variant_engine_payload_check" CHECK ((
        "template_channel_variant"."engine" = 'primitive'
        AND "template_channel_variant"."workspace_entry_id" IS NULL
        AND "template_channel_variant"."content" IS NOT NULL
      ) OR (
        "template_channel_variant"."engine" = 'reactEmail'
        AND "template_channel_variant"."variables" IS NULL
        AND "template_channel_variant"."content" IS NOT NULL
        AND coalesce("template_channel_variant"."content"->>'subject', '') <> ''
      ));
