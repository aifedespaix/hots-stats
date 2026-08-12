CREATE TABLE "draft_pseudo_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"pseudo" text NOT NULL,
	"chosen_battletag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_pseudo_preferences" ADD CONSTRAINT "draft_pseudo_preferences_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_pseudo_preferences_viewer_pseudo_idx" ON "draft_pseudo_preferences" USING btree ("viewer_user_id","pseudo");