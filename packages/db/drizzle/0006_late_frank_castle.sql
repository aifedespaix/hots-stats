CREATE TYPE "public"."daemon_error_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."daemon_error_type" AS ENUM('parse', 'auth', 'validation', 'server');--> statement-breakpoint
CREATE TABLE "daemon_ingest_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"replay_hash" text,
	"base_build" integer,
	"error_type" "daemon_error_type" NOT NULL,
	"error_message" text NOT NULL,
	"error_log" text,
	"parser_version" text,
	"daemon_version" text,
	"status" "daemon_error_status" DEFAULT 'open' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daemon_ingest_errors" ADD CONSTRAINT "daemon_ingest_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_ingest_errors_user_replay_idx" ON "daemon_ingest_errors" USING btree ("user_id","replay_hash");