-- 0014 defined game_fingerprint as map + duration_seconds + roster. In
-- practice duration_seconds isn't reliably identical between two players'
-- own replays of the same game: it's `(m_elapsedGameLoops - gates_open_loop)
-- / 16`, and gates_open_loop comes from scanning tracker events for a
-- "GatesOpen" event -- older daemon builds could miss/mishandle that event
-- and fall back to gates_open_loop = 0, inflating duration by the pre-game
-- loading time (tens of seconds). Two uploads of the exact same match from
-- daemons on different vintages then land on two different durations, so
-- 0014's fingerprint didn't match and the duplicate survived its cleanup.
--
-- Recomputes the fingerprint from map + roster only (still an extremely
-- strong identity: the exact same map plus the exact same battletag/hero
-- pairing for every player) and re-runs the same dedup pass.
ALTER TABLE "matches" DROP CONSTRAINT "matches_game_fingerprint_unique";
--> statement-breakpoint
WITH source AS (
	SELECT
		m.id,
		m.map_id || '|' ||
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
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_fingerprint_unique" UNIQUE("game_fingerprint");
