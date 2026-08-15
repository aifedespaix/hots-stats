CREATE TABLE "match_deaths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_player_id" uuid NOT NULL,
	"at_seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_level_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_player_id" uuid NOT NULL,
	"at_seconds" integer NOT NULL,
	"level" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_deaths" ADD CONSTRAINT "match_deaths_match_player_id_match_players_id_fk" FOREIGN KEY ("match_player_id") REFERENCES "public"."match_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_level_snapshots" ADD CONSTRAINT "match_level_snapshots_match_player_id_match_players_id_fk" FOREIGN KEY ("match_player_id") REFERENCES "public"."match_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_deaths_match_player_id_idx" ON "match_deaths" USING btree ("match_player_id");--> statement-breakpoint
CREATE INDEX "match_level_snapshots_match_player_id_idx" ON "match_level_snapshots" USING btree ("match_player_id");