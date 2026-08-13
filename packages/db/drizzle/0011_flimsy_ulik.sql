CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "match_players_battletag_trgm_idx" ON "match_players" USING gin ("battletag" gin_trgm_ops);
