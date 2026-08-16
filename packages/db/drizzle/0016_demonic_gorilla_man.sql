CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "map_calibrations" (
	"map_id" text PRIMARY KEY NOT NULL,
	"min_x" real NOT NULL,
	"max_x" real NOT NULL,
	"min_y" real NOT NULL,
	"max_y" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_map_samples" (
	"map_id" text PRIMARY KEY NOT NULL,
	"raw_points" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "map_calibrations" ADD CONSTRAINT "map_calibrations_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_map_samples" ADD CONSTRAINT "raw_map_samples_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;