DROP INDEX "hero_map_global_spatial_rollup_unique";--> statement-breakpoint
DROP INDEX "hero_map_player_spatial_rollup_unique";--> statement-breakpoint
ALTER TABLE "map_calibrations" DROP CONSTRAINT "map_calibrations_pkey";--> statement-breakpoint
ALTER TABLE "match_spatial_grids" DROP CONSTRAINT "match_spatial_grids_pkey";--> statement-breakpoint
ALTER TABLE "match_hero_trajectories" DROP CONSTRAINT "match_hero_trajectories_pkey";--> statement-breakpoint
ALTER TABLE "match_deaths" ADD COLUMN "layer" text;--> statement-breakpoint
ALTER TABLE "map_calibrations" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_spatial_grids" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hero_map_global_spatial_rollup" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "hero_map_player_spatial_rollup" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_hero_trajectories" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "map_calibrations" ADD CONSTRAINT "map_calibrations_map_id_layer_pk" PRIMARY KEY("map_id","layer");--> statement-breakpoint
ALTER TABLE "match_spatial_grids" ADD CONSTRAINT "match_spatial_grids_match_player_id_layer_pk" PRIMARY KEY("match_player_id","layer");--> statement-breakpoint
ALTER TABLE "match_hero_trajectories" ADD CONSTRAINT "match_hero_trajectories_match_player_id_layer_pk" PRIMARY KEY("match_player_id","layer");--> statement-breakpoint
CREATE UNIQUE INDEX "hero_map_global_spatial_rollup_unique" ON "hero_map_global_spatial_rollup" USING btree ("map_id","hero_id","layer","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "hero_map_player_spatial_rollup_unique" ON "hero_map_player_spatial_rollup" USING btree ("map_id","hero_id","layer","battletag","outcome");