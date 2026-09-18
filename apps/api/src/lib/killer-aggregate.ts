import type { KillerEntry, KillersResponse } from "@hots-stats/shared-types";

/** One credited killer on one of the subject's deaths, already joined by the
 * caller to the hero that battletag played in the same match. */
export interface KillerCredit {
  battletag: string;
  /** Hero id played by the killer in that match, or null when the battletag is
   * not part of the match roster. */
  heroId: string | null;
}

/** One of the subject's deaths inside the requested scope/filters. */
export interface KillerDeathInput {
  matchId: string;
  /** The subject won that match. */
  winner: boolean;
  /** True for `killType === "hero"`, false for "other" or null. */
  heroKill: boolean;
  /** Credited killer battletags; empty for a non-hero death. */
  credits: KillerCredit[];
}

/** Most frequent key, ties broken lexicographically for a stable output. */
function modalKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && key < best)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function winrate(wins: Set<string>, matches: Set<string>): number {
  return matches.size > 0 ? wins.size / matches.size : 0;
}

/** Battletag ascending, with a null battletag last, for the stable tie-break. */
function compareBattletag(a: KillerEntry, b: KillerEntry): number {
  if (a.killerBattletag === b.killerBattletag) return 0;
  if (a.killerBattletag === null) return 1;
  if (b.killerBattletag === null) return -1;
  return a.killerBattletag.toLowerCase().localeCompare(b.killerBattletag.toLowerCase());
}

/**
 * Aggregates the subject's deaths into the C3 killer lists. Pure: no database
 * access. Deaths without a credited battletag (killType "other") stay in
 * `totalDeaths` and in the `totalDeaths - deathsWithKiller` gap, never in either
 * list. A death with several credited killers counts once for each, so per-entry
 * counts can sum above `totalDeaths`; `deathsWithKiller` still counts the death
 * exactly once (always `<= totalDeaths`).
 */
export function buildKillersResponse(
  deaths: KillerDeathInput[],
  heroNames: Record<string, string>,
  scope: "personal" | "global" = "personal",
): KillersResponse {
  const totalDeaths = deaths.length;
  let deathsWithKiller = 0;

  interface KillerAccumulator {
    battletag: string;
    deaths: number;
    matches: Set<string>;
    wins: Set<string>;
    heroCounts: Map<string, number>;
  }
  interface HeroAccumulator {
    heroId: string;
    deaths: number;
    matches: Set<string>;
    wins: Set<string>;
    battletagCounts: Map<string, number>;
  }

  const killers = new Map<string, KillerAccumulator>();
  const heroes = new Map<string, HeroAccumulator>();
  const battletagLabels = new Map<string, string>();

  for (const death of deaths) {
    const credited = death.credits.filter((credit) => credit.battletag.trim().length > 0);
    if (credited.length > 0) deathsWithKiller += 1;

    for (const credit of credited) {
      const tag = credit.battletag.trim();
      const key = tag.toLowerCase();
      if (!battletagLabels.has(key)) battletagLabels.set(key, tag);

      let killer = killers.get(key);
      if (!killer) {
        killer = { battletag: tag, deaths: 0, matches: new Set(), wins: new Set(), heroCounts: new Map() };
        killers.set(key, killer);
      }
      killer.deaths += 1;
      killer.matches.add(death.matchId);
      if (death.winner) killer.wins.add(death.matchId);
      if (credit.heroId) {
        killer.heroCounts.set(credit.heroId, (killer.heroCounts.get(credit.heroId) ?? 0) + 1);
      }

      if (death.heroKill && credit.heroId) {
        let hero = heroes.get(credit.heroId);
        if (!hero) {
          hero = {
            heroId: credit.heroId,
            deaths: 0,
            matches: new Set(),
            wins: new Set(),
            battletagCounts: new Map(),
          };
          heroes.set(credit.heroId, hero);
        }
        hero.deaths += 1;
        hero.matches.add(death.matchId);
        if (death.winner) hero.wins.add(death.matchId);
        hero.battletagCounts.set(key, (hero.battletagCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const topKillers: KillerEntry[] = [...killers.values()]
    .map((killer) => {
      const heroId = modalKey(killer.heroCounts);
      return {
        killerBattletag: killer.battletag,
        killerHeroId: heroId,
        killerHeroName: heroId ? (heroNames[heroId] ?? null) : null,
        deaths: killer.deaths,
        share: totalDeaths > 0 ? killer.deaths / totalDeaths : 0,
        winrateWhenKilledBy: winrate(killer.wins, killer.matches),
      };
    })
    .sort((a, b) => b.deaths - a.deaths || compareBattletag(a, b));

  const topKillerHeroes: KillerEntry[] = [...heroes.values()]
    .map((hero) => {
      const tagKey = modalKey(hero.battletagCounts);
      return {
        killerBattletag: tagKey ? (battletagLabels.get(tagKey) ?? null) : null,
        killerHeroId: hero.heroId,
        killerHeroName: heroNames[hero.heroId] ?? null,
        deaths: hero.deaths,
        share: totalDeaths > 0 ? hero.deaths / totalDeaths : 0,
        winrateWhenKilledBy: winrate(hero.wins, hero.matches),
      };
    })
    .sort(
      (a, b) =>
        b.deaths - a.deaths ||
        compareBattletag(a, b) ||
        (a.killerHeroId ?? "").localeCompare(b.killerHeroId ?? ""),
    );

  return { scope, totalDeaths, deathsWithKiller, topKillers, topKillerHeroes };
}
