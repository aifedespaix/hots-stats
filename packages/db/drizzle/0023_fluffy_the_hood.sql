-- structure_type was fort/keep/wall/core and never held a single row: the
-- daemon never emitted a structure event at all (see the 1.16 changelog in
-- daemon-python/src/constants.py). Postgres cannot drop a value from an enum,
-- so the type is recreated -- with a CASE that still maps any row that somehow
-- exists, rather than a bare cast that would fail on the old values.
ALTER TABLE "match_structure_events" ALTER COLUMN "structure_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."structure_type";--> statement-breakpoint
CREATE TYPE "public"."structure_type" AS ENUM('core', 'bastion', 'tower', 'gate');--> statement-breakpoint
ALTER TABLE "match_structure_events" ALTER COLUMN "structure_type" SET DATA TYPE "public"."structure_type" USING (
  CASE "structure_type"
    WHEN 'fort' THEN 'bastion'
    WHEN 'keep' THEN 'bastion'
    WHEN 'wall' THEN 'tower'
    ELSE "structure_type"
  END
)::"public"."structure_type";
