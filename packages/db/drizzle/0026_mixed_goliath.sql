ALTER TYPE "public"."daemon_error_type" ADD VALUE 'quarantine';--> statement-breakpoint
ALTER TYPE "public"."daemon_error_type" ADD VALUE 'runtime';--> statement-breakpoint
ALTER TYPE "public"."daemon_error_type" ADD VALUE 'dependency';--> statement-breakpoint
ALTER TABLE "daemon_ingest_errors" ADD COLUMN "heroprotocol_version" text;--> statement-breakpoint
ALTER TABLE "daemon_ingest_errors" ADD COLUMN "fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_ingest_errors_user_fingerprint_idx" ON "daemon_ingest_errors" USING btree ("user_id","fingerprint") WHERE "daemon_ingest_errors"."fingerprint" IS NOT NULL;