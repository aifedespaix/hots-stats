-- Adds a content-based `game_fingerprint` to `matches` -- see
-- apps/api/src/lib/game-fingerprint.ts for what it's built from and why.
--
-- `replay_hash` (the existing unique column) is a hash of the raw replay
-- *file bytes*, which differ between each participant's own local copy of
-- the same game -- so two players uploading the same game each got past
-- the `replay_hash` uniqueness check and were inserted as two separate
-- matches. This migration adds the real dedup key and, since the bug has
-- already produced duplicates in production, backfills + collapses them
-- before the column is made NOT NULL/UNIQUE.
ALTER TABLE "matches" ADD COLUMN "game_fingerprint" text;
--> statement-breakpoint
WITH source AS (
	SELECT
		m.id,
		m.map_id || '|' || m.duration_seconds::text || '|' ||
			string_agg(mp.battletag || ':' || mp.hero_id, ',' ORDER BY mp.battletag) AS fingerprint_source
	FROM "matches" m
	JOIN "match_players" mp ON mp.match_id = m.id
	GROUP BY m.id
)
UPDATE "matches"
SET "game_fingerprint" = encode(sha256(convert_to(source.fingerprint_source, 'UTF8')), 'hex')
FROM source
WHERE source.id = "matches"."id";
--> statement-breakpoint
-- Duplicate groups: same fingerprint, multiple match rows. Keep one per
-- group -- highest parser_version (most complete data, mirrors the app's
-- own "only overwrite with a strictly newer parser version" upsert rule),
-- tie-broken by most recently updated, then by id for determinism -- and
-- delete the rest. `match_players`/`talent_picks`/`match_deaths`/
-- `match_level_snapshots` all cascade off `matches`/`match_players`, so
-- deleting the losing match rows here is enough to clean up everything
-- that hung off them.
WITH ranked AS (
	SELECT
		id,
		row_number() OVER (
			PARTITION BY game_fingerprint
			ORDER BY
				coalesce(nullif(split_part(parser_version, '.', 1), ''), '0')::int DESC,
				coalesce(nullif(split_part(parser_version, '.', 2), ''), '0')::int DESC,
				updated_at DESC,
				id ASC
		) AS rn
	FROM "matches"
)
DELETE FROM "matches"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "game_fingerprint" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_fingerprint_unique" UNIQUE("game_fingerprint");
