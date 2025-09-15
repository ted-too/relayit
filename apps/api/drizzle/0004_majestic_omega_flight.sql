-- Backfill any NULL channel_data values with empty JSON object before adding NOT NULL constraint
UPDATE "provider_identity" SET "channel_data" = '{}'::jsonb WHERE "channel_data" IS NULL;

-- Now safely add the NOT NULL constraint
ALTER TABLE "provider_identity" ALTER COLUMN "channel_data" SET NOT NULL;