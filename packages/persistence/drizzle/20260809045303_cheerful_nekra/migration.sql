CREATE TYPE "job_dead_letter_status" AS ENUM('pending', 'replayed', 'discarded');--> statement-breakpoint
CREATE TABLE "job_dead_letter" (
	"id" text PRIMARY KEY,
	"job_name" text NOT NULL,
	"original_stream_id" text NOT NULL,
	"payload" text NOT NULL,
	"wire_version" integer NOT NULL,
	"attempts" integer NOT NULL,
	"first_enqueued_at" timestamp NOT NULL,
	"failed_at" timestamp NOT NULL,
	"failure" jsonb NOT NULL,
	"status" "job_dead_letter_status" DEFAULT 'pending'::"job_dead_letter_status" NOT NULL,
	"replayed_at" timestamp,
	"discarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_dead_letter_job_stream_uidx" ON "job_dead_letter" ("job_name","original_stream_id");--> statement-breakpoint
CREATE INDEX "job_dead_letter_status_failed_idx" ON "job_dead_letter" ("status","failed_at");