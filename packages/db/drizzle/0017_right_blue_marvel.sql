CREATE TYPE "public"."kill_type" AS ENUM('hero', 'other');--> statement-breakpoint
CREATE TYPE "public"."match_outcome" AS ENUM('win', 'loss');--> statement-breakpoint
CREATE TABLE "match_spatial_grids" (
	"match_player_id" uuid PRIMARY KEY NOT NULL,
	"grid_cols" integer NOT NULL,
	"grid_rows" integer NOT NULL,
	"presence_grid" jsonb NOT NULL,
	"kills_grid" jsonb NOT NULL,
	"deaths_grid" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hero_map_global_spatial_rollup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" text NOT NULL,
	"hero_id" text NOT NULL,
	"outcome" "match_outcome" NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"grid_cols" integer NOT NULL,
	"grid_rows" integer NOT NULL,
	"presence_grid" jsonb NOT NULL,
	"kills_grid" jsonb NOT NULL,
	"deaths_grid" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hero_map_player_spatial_rollup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" text NOT NULL,
	"hero_id" text NOT NULL,
	"battletag" text NOT NULL,
	"outcome" "match_outcome" NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"grid_cols" integer NOT NULL,
	"grid_rows" integer NOT NULL,
	"presence_grid" jsonb NOT NULL,
	"kills_grid" jsonb NOT NULL,
	"deaths_grid" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_deaths" ADD COLUMN "x" real;--> statement-breakpoint
ALTER TABLE "match_deaths" ADD COLUMN "y" real;--> statement-breakpoint
ALTER TABLE "match_deaths" ADD COLUMN "killers" jsonb;--> statement-breakpoint
ALTER TABLE "match_deaths" ADD COLUMN "kill_type" "kill_type";--> statement-breakpoint
ALTER TABLE "match_spatial_grids" ADD CONSTRAINT "match_spatial_grids_match_player_id_match_players_id_fk" FOREIGN KEY ("match_player_id") REFERENCES "public"."match_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_map_global_spatial_rollup" ADD CONSTRAINT "hero_map_global_spatial_rollup_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_map_global_spatial_rollup" ADD CONSTRAINT "hero_map_global_spatial_rollup_hero_id_heroes_id_fk" FOREIGN KEY ("hero_id") REFERENCES "public"."heroes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_map_player_spatial_rollup" ADD CONSTRAINT "hero_map_player_spatial_rollup_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_map_player_spatial_rollup" ADD CONSTRAINT "hero_map_player_spatial_rollup_hero_id_heroes_id_fk" FOREIGN KEY ("hero_id") REFERENCES "public"."heroes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hero_map_global_spatial_rollup_unique" ON "hero_map_global_spatial_rollup" USING btree ("map_id","hero_id","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "hero_map_player_spatial_rollup_unique" ON "hero_map_player_spatial_rollup" USING btree ("map_id","hero_id","battletag","outcome");