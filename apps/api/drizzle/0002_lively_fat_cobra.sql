ALTER TABLE "template" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "category" SET DEFAULT 'transactional'::text;--> statement-breakpoint
DROP TYPE "public"."template_category";--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('transactional');--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "category" SET DEFAULT 'transactional'::"public"."template_category";--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "category" SET DATA TYPE "public"."template_category" USING "category"::"public"."template_category";