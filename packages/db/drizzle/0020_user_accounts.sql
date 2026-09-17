CREATE TYPE "public"."user_account_source" AS ENUM('legacy', 'battlenet', 'daemon', 'manual');--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"battletag" text NOT NULL,
	"toon_handle" text,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" "user_account_source" NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_user_id_battletag_idx" ON "user_accounts" USING btree ("user_id","battletag");--> statement-breakpoint
CREATE INDEX "user_accounts_battletag_idx" ON "user_accounts" USING btree ("battletag");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_primary_idx" ON "user_accounts" USING btree ("user_id") WHERE "user_accounts"."is_primary";--> statement-breakpoint
CREATE INDEX "match_players_battletag_idx" ON "match_players" USING btree ("battletag");

--> statement-breakpoint
-- Backfill: every already-claimed users.battletag becomes that account's primary.
-- Idempotent: ON CONFLICT DO NOTHING makes a re-run (or a partially applied
-- migration) a no-op instead of a duplicate-key failure.
INSERT INTO "user_accounts" ("user_id", "battletag", "is_primary", "source")
SELECT "id", "battletag", true, 'legacy'
FROM "users"
WHERE "battletag" IS NOT NULL
ON CONFLICT DO NOTHING;
