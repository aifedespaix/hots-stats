CREATE TYPE "public"."structure_type" AS ENUM('fort', 'keep', 'wall', 'core');--> statement-breakpoint
CREATE TABLE "match_hero_trajectories" (
	"match_player_id" uuid PRIMARY KEY NOT NULL,
	"at_seconds" jsonb NOT NULL,
	"x" jsonb NOT NULL,
	"y" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_structure_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team" integer NOT NULL,
	"at_seconds" integer NOT NULL,
	"structure_type" "structure_type" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_hero_trajectories" ADD CONSTRAINT "match_hero_trajectories_match_player_id_match_players_id_fk" FOREIGN KEY ("match_player_id") REFERENCES "public"."match_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_structure_events" ADD CONSTRAINT "match_structure_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_structure_events_match_id_idx" ON "match_structure_events" USING btree ("match_id");