import type { MapWeaknessStats, MatchupWeaknessStats, UnderperformingTalentStats } from "@hots-stats/shared-types";
import { DRAFT_MIN_RANKED_GAMES_FOR_RANKING } from "@hots-stats/shared-types";
import { formatPercent } from "../composables/useFormat";

export interface WeaknessLeak {
  key: string;
  label: string;
  detail: string;
  /** Higher = worse. Only meaningful for ranking within this list, not as an absolute score. */
  severity: number;
}

export interface WeaknessTrend {
  recentWinrate: number;
  recentGames: number;
  allTimeWinrate: number;
}

/**
 * Picks the single worst map, worst matchup, worst talent habit (and,
 * optionally, a cooling-off recent-form trend) into one ranked list --
 * shared by the Dashboard teaser (map/matchup/talent only) and the full
 * Diagnostic page (adds `trend`), so both agree on what counts as "your
 * biggest leak right now" instead of two separate ad hoc rankings.
 *
 * Maps/matchups apply the same minimum-games floor and "actually losing"
 * (< 50%) bar the rest of the app uses before a stat is trusted; talents
 * need no extra filtering here since the API only ever returns talents that
 * already cleared its own habit/underperformance thresholds.
 */
export function getTopWeaknesses(
  data: { maps: MapWeaknessStats[]; matchups: MatchupWeaknessStats[]; talents: UnderperformingTalentStats[] },
  options: { limit?: number; trend?: WeaknessTrend } = {},
): WeaknessLeak[] {
  const { limit = 3, trend } = options;
  const leaks: WeaknessLeak[] = [];

  for (const map of data.maps) {
    if (map.gamesPlayed < DRAFT_MIN_RANKED_GAMES_FOR_RANKING || map.winrate >= 0.5) continue;
    leaks.push({
      key: `map:${map.mapId}`,
      label: map.mapName,
      detail: `${formatPercent(map.winrate)} de victoires sur ${map.gamesPlayed} parties classées`,
      severity: 0.5 - map.winrate,
    });
  }

  for (const matchup of data.matchups) {
    if (matchup.gamesPlayed < DRAFT_MIN_RANKED_GAMES_FOR_RANKING || matchup.winrate >= 0.5) continue;
    leaks.push({
      key: `matchup:${matchup.heroId}`,
      label: `Face à ${matchup.heroName}`,
      detail: `${formatPercent(matchup.winrate)} de victoires sur ${matchup.gamesPlayed} parties classées`,
      severity: 0.5 - matchup.winrate,
    });
  }

  for (const talent of data.talents) {
    leaks.push({
      key: `talent:${talent.heroId}:${talent.tier}:${talent.talentId}`,
      label: `${talent.heroName} - palier ${talent.tier}`,
      detail: `Ton choix habituel (${formatPercent(talent.pickRate)} des picks) gagne ${formatPercent(talent.talentWinrate)}, contre ${formatPercent(talent.heroWinrate)} en moyenne sur ce héros`,
      severity: talent.heroWinrate - talent.talentWinrate,
    });
  }

  if (trend && trend.recentGames >= DRAFT_MIN_RANKED_GAMES_FOR_RANKING) {
    const delta = trend.allTimeWinrate - trend.recentWinrate;
    if (delta >= 0.1) {
      leaks.push({
        key: "trend",
        label: "Forme récente en baisse",
        detail: `${formatPercent(trend.recentWinrate)} sur tes ${trend.recentGames} dernières parties classées, contre ${formatPercent(trend.allTimeWinrate)} habituellement`,
        severity: delta,
      });
    }
  }

  return leaks.sort((a, b) => b.severity - a.severity).slice(0, limit);
}
