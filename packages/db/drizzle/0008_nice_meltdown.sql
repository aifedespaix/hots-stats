CREATE TABLE "player_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"battletag" text NOT NULL,
	"is_fdp" boolean DEFAULT false NOT NULL,
	"is_pgm" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_annotations" ADD CONSTRAINT "player_annotations_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_annotations_viewer_battletag_idx" ON "player_annotations" USING btree ("viewer_user_id","battletag");