CREATE TYPE "job_outbox_status" AS ENUM('pending', 'published');--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" text PRIMARY KEY,
	"job_name" text NOT NULL,
	"payload" text NOT NULL,
	"delay_until" timestamp,
	"status" "job_outbox_status" DEFAULT 'pending'::"job_outbox_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" text,
	"claim_expires_at" timestamp,
	"last_error" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_outbox_pending_created_idx" ON "job_outbox" ("status","created_at");--> statement-breakpoint
CREATE INDEX "job_outbox_claim_expires_idx" ON "job_outbox" ("status","claim_expires_at");