CREATE TABLE "player_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"target_value" real NOT NULL,
	"direction" text NOT NULL,
	"scope_hero_id" text,
	"scope_map_id" text,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"achieved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "player_goals" ADD CONSTRAINT "player_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_goals_user_id_idx" ON "player_goals" USING btree ("user_id");