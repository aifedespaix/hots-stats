CREATE TABLE "match_objective_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team" integer,
	"at_seconds" integer NOT NULL,
	"kind" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
ALTER TABLE "match_objective_events" ADD CONSTRAINT "match_objective_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_objective_events_match_id_idx" ON "match_objective_events" USING btree ("match_id");