ALTER TABLE "message" ALTER COLUMN "payload" SET DATA TYPE jsonb USING payload::jsonb;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "payload" SET NOT NULL;