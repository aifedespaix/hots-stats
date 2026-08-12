CREATE TYPE "public"."quarantine_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "known_builds" (
	"base_build" integer PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" text DEFAULT 'check-build-cli' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_replays_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_build" integer NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"uploaded_by_user_id" uuid,
	"status" "quarantine_status" DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_details" jsonb
);
--> statement-breakpoint
ALTER TABLE "raw_replays_quarantine" ADD CONSTRAINT "raw_replays_quarantine_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;