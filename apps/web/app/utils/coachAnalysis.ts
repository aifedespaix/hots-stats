import { formatDuration, formatHeroRole, formatPercent } from "../composables/useFormat";
import type {
  CoachAnalysisInput,
  CoachInsightResult,
  CoachOccurrence,
  CoachVerdict,
  ScoreboardRow,
  TopPerformerBadge,
  TopPerformerCategory,
} from "../types/coach";
import type { MatchDetailPlayer } from "../types/matches";
import {
  RESPAWN_PRESENCE_WINDOW_SECONDS,
  STAGGER_THRESHOLD_SECONDS,
  firstDeathCount,
  outnumberedDeaths,
  staggeredDeathEvents,
  talentDelayFightEvents,
  type RuleSubject,
} from "@hots-stats/shared-types";

// Rules and constants live in @hots-stats/shared-types (see coach-rules.ts)
// so the API's aggregation services consume the exact same predicates.
// Re-exported here because Nuxt auto-imports this utils module's exports
// (PlayerTalents.vue relies on TALENT_TIER_LEVELS without importing it).
export { TALENT_TIER_LEVELS } from "@hots-stats/shared-types";

// --- Scoreboard (Tab 1) ------------------------------------------------

/** Enriches the raw per-player box score with match-relative ratios (kill
 * participation, damage/death, XP share) and the viewer's ally/self flags. */
export function buildScoreboardRows(players: MatchDetailPlayer[], myBattletags: Set<string>): ScoreboardRow[] {
  const teamKills = new Map<number, number>();
  const teamXp = new Map<number, number>();
  for (const p of players) {
    teamKills.set(p.team, (teamKills.get(p.team) ?? 0) + p.kills);
    teamXp.set(p.team, (teamXp.get(p.team) ?? 0) + p.experienceContribution);
  }
  // Falls back to team 0 as the reference "ally" side when the viewer isn't
  // a participant at all (e.g. browsing a friend's match via the friend
  // access rule in `GET /matches/:id`) -- keeps the team split coherent
  // instead of rendering all 10 players as "enemy".
  const myTeam = players.find((p) => myBattletags.has(p.battletag.toLowerCase()))?.team ?? 0;

  return players.map((p) => {
    const teamKillTotal = teamKills.get(p.team) ?? 0;
    const teamXpTotal = teamXp.get(p.team) ?? 0;
    return {
      ...p,
      killParticipation: teamKillTotal > 0 ? (p.kills + p.assists) / teamKillTotal : 0,
      damagePerDeath: p.heroDamage / Math.max(p.deaths, 1),
      xpShare: teamXpTotal > 0 ? p.experienceContribution / teamXpTotal : 0,
      isAlly: p.team === myTeam,
      isMe: myBattletags.has(p.battletag.toLowerCase()),
    };
  });
}

interface TopPerformerConfig {
  category: TopPerformerCategory;
  label: string;
  icon: string;
  key: keyof Pick<MatchDetailPlayer, "kills" | "heroDamage" | "siegeDamage" | "healing" | "damageTaken" | "experienceContribution">;
}

const TOP_PERFORMER_CONFIG: TopPerformerConfig[] = [
  { category: "kills", label: "Plus de kills", icon: "i-heroicons-bolt", key: "kills" },
  { category: "heroDamage", label: "Plus de dégâts héros", icon: "i-heroicons-fire", key: "heroDamage" },
  { category: "siegeDamage", label: "Plus de dégâts de siège", icon: "i-heroicons-building-office-2", key: "siegeDamage" },
  { category: "healing", label: "Plus de soin", icon: "i-heroicons-heart", key: "healing" },
  { category: "damageTaken", label: "Plus de dégâts subis", icon: "i-heroicons-shield-exclamation", key: "damageTaken" },
  { category: "experienceContribution", label: "Plus de contribution XP", icon: "i-heroicons-sparkles", key: "experienceContribution" },
];

/** Per-category "top of the match" badges (all 10 players, not per-team --
 * a broadcast-style MVP callout). Ties all get the badge; an all-zero
 * category (e.g. no one healed) is skipped rather than crowning a 0. */
export function topPerformerBadges(rows: ScoreboardRow[]): Map<string, TopPerformerBadge[]> {
  const result = new Map<string, TopPerformerBadge[]>();
  if (rows.length === 0) return result;

  for (const config of TOP_PERFORMER_CONFIG) {
    const max = Math.max(...rows.map((r) => r[config.key]));
    if (max <= 0) continue;
    for (const row of rows) {
      if (row[config.key] !== max) continue;
      const badges = result.get(row.id) ?? [];
      badges.push({ category: config.category, label: config.label, icon: config.icon });
      result.set(row.id, badges);
    }
  }

  return result;
}

// --- Coach insights (Tab 2) ---------------------------------------------

/** Minimal subject shape the shared rules consume, normalized to their 0/1
 * team encoding (match_players.team is a raw smallint). */
function subjectOf(me: ScoreboardRow): RuleSubject {
  return { battletag: me.battletag, team: me.team === 1 ? 1 : 0, kills: me.kills, deaths: me.deaths, assists: me.assists };
}

function computeEfficiencyInsight({ me, myTeam }: CoachAnalysisInput): CoachInsightResult {
  const teammates = myTeam.filter((p) => p.battletag !== me.battletag);
  const myKda = (me.kills + me.assists) / Math.max(me.deaths, 1);
  const teamAvgKda =
    teammates.length > 0
      ? teammates.reduce((sum, p) => sum + (p.kills + p.assists) / Math.max(p.deaths, 1), 0) / teammates.length
      : myKda;

  const highParticipation = me.killParticipation >= 0.5;
  const aboveTeamKda = myKda >= teamAvgKda;

  let verdict: CoachVerdict;
  let summary: string;
  if (aboveTeamKda && highParticipation) {
    verdict = "positive";
    summary = `KDA de ${myKda.toFixed(2)}, au-dessus de la moyenne de ton équipe (${teamAvgKda.toFixed(2)}), avec ${formatPercent(me.killParticipation)} de participation aux kills.`;
  } else if (!aboveTeamKda && !highParticipation) {
    verdict = "negative";
    summary = `KDA de ${myKda.toFixed(2)} (moyenne équipe : ${teamAvgKda.toFixed(2)}) et seulement ${formatPercent(me.killParticipation)} de participation aux kills -- peu présent dans les fights, et peu rentable quand tu y es.`;
  } else if (!aboveTeamKda) {
    verdict = "neutral";
    summary = `${formatPercent(me.killParticipation)} de participation aux kills (bonne présence dans les fights) mais un KDA de ${myKda.toFixed(2)}, sous la moyenne de ton équipe (${teamAvgKda.toFixed(2)}) -- tu es de tous les combats mais ils te coûtent cher.`;
  } else {
    verdict = "neutral";
    summary = `KDA de ${myKda.toFixed(2)}, au-dessus de la moyenne de ton équipe (${teamAvgKda.toFixed(2)}), mais seulement ${formatPercent(me.killParticipation)} de participation aux kills -- efficace quand tu y es, mais souvent absent des fights.`;
  }

  return {
    pillar: "efficiency",
    icon: "i-heroicons-scale",
    title: "Efficacité globale",
    methodology: "Ton KDA ((kills + assists) / morts) comparé à la moyenne de tes 4 coéquipiers, croisé avec ta participation aux kills de l'équipe. Disponible immédiatement -- ne dépend que du score final, déjà collecté.",
    status: "ready",
    verdict,
    summary,
    metricLabel: "KDA",
    metricValue: myKda.toFixed(2),
  };
}

function computeObjectiveFootprintInsight({ me, myTeam }: CoachAnalysisInput): CoachInsightResult {
  const teamSiege = myTeam.reduce((sum, p) => sum + p.siegeDamage, 0);
  const teamHeroDmg = myTeam.reduce((sum, p) => sum + p.heroDamage, 0);
  const teamHealing = myTeam.reduce((sum, p) => sum + p.healing, 0);

  const isHealer = me.heroRole === "Healer" || me.heroRole === "Support";
  const siegeShare = teamSiege > 0 ? me.siegeDamage / teamSiege : 0;
  const heroDmgShare = teamHeroDmg > 0 ? me.heroDamage / teamHeroDmg : 0;
  const healingShare = teamHealing > 0 ? me.healing / teamHealing : 0;

  const summary = isHealer
    ? `${formatPercent(healingShare)} du soin total de l'équipe.`
    : `${formatPercent(siegeShare)} des dégâts de siège de l'équipe, contre ${formatPercent(heroDmgShare)} des dégâts héros.`;

  return {
    pillar: "objectiveFootprint",
    icon: "i-heroicons-flag",
    title: "Empreinte objectifs",
    methodology: `Ta part des dégâts de siège (ou du soin en Soigneur/Soutien) dans le total de ton équipe -- purement informatif, sans verdict bon/mauvais : un Tank ou un Soigneur pousse rarement autant qu'un Assassin. À lire selon ton rôle (${formatHeroRole(me.heroRole)}).`,
    status: "ready",
    verdict: "neutral",
    summary,
    metricLabel: isHealer ? "Part du soin d'équipe" : "Part des dégâts de siège",
    metricValue: formatPercent(isHealer ? healingShare : siegeShare),
  };
}

function computeOutnumberedFightsInsight({ me, timeline }: CoachAnalysisInput): CoachInsightResult {
  const meta = {
    pillar: "outnumberedFights" as const,
    icon: "i-heroicons-user-group",
    title: "Fights en sous-nombre",
    methodology: `Pour chacune de tes morts, on compte combien de coéquipiers ont un décès dans les ${RESPAWN_PRESENCE_WINDOW_SECONDS}s précédentes (présumés pas encore de retour) contre le même calcul côté adverse. Approximation : le vrai timer de résurrection dépend du niveau et du temps de jeu -- non simulé faute de cette donnée.`,
  };

  if (!timeline) {
    return {
      ...meta,
      status: "unavailable",
      reason: "Nécessite le timestamp de chaque mort du replay (SUnitDiedEvent) -- pas encore extrait par le pipeline d'ingestion.",
    };
  }

  const myDeaths = timeline.deaths.filter((d) => d.battletag === me.battletag);
  if (myDeaths.length === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: "Aucune mort ce match : impossible d'avoir combattu en sous-nombre en mourant." };
  }

  const occurrences: CoachOccurrence[] = outnumberedDeaths(timeline.deaths, subjectOf(me)).map((event) => ({
    atLabel: formatDuration(event.atSeconds),
    detail: `Mort en infériorité estimée (~${event.myTeamPresent} vs ${event.enemyPresent}).`,
  }));

  if (occurrences.length === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: `${myDeaths.length} mort(s) ce match, aucune en infériorité numérique détectée.` };
  }

  return {
    ...meta,
    status: "ready",
    verdict: "negative",
    summary: `${occurrences.length} mort(s) sur ${myDeaths.length} avec ton équipe en infériorité numérique estimée.`,
    metricLabel: "Morts en sous-nombre",
    metricValue: `${occurrences.length}/${myDeaths.length}`,
    occurrences,
  };
}

function computeTalentDelayInsight({ me, enemyTeam, timeline }: CoachAnalysisInput): CoachInsightResult {
  const meta = {
    pillar: "talentDelay" as const,
    icon: "i-heroicons-arrow-trending-down",
    title: "Retard de talent (Talent Down)",
    methodology: "Au début de chaque fight (cluster de morts impliquant les deux équipes), on compare ton niveau au niveau moyen de l'équipe adverse, convertis en palier de talent (1/4/7/10/13/16/20).",
  };

  if (!timeline || timeline.levelSnapshots.length === 0) {
    return {
      ...meta,
      status: "unavailable",
      reason: "Nécessite un relevé de niveau au fil du temps (SPlayerStatsEvent périodique) -- pas encore extrait par le pipeline d'ingestion.",
    };
  }

  const { events, evaluated } = talentDelayFightEvents(
    timeline.deaths,
    timeline.levelSnapshots,
    subjectOf(me),
    enemyTeam.map((p) => p.battletag),
  );

  const occurrences: CoachOccurrence[] = events.map((event) => ({
    atLabel: formatDuration(event.atSeconds),
    detail: `Palier ${event.myTier} (niveau ${event.myLevel}) engagé contre palier ${event.enemyTier} (niveau adverse moyen ${event.enemyAvgLevel.toFixed(1)}).`,
  }));

  if (evaluated === 0) {
    return { ...meta, status: "unavailable", reason: "Aucun combat exploitable (niveau inconnu au moment des morts recensées)." };
  }

  if (occurrences.length === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: `Palier de talent toujours au moins égal à l'adversaire sur ${evaluated} combat(s) analysé(s).` };
  }

  return {
    ...meta,
    status: "ready",
    verdict: "negative",
    summary: `${occurrences.length} combat(s) sur ${evaluated} engagé(s) avec un palier de talent en retard.`,
    metricLabel: "Combats en retard de palier",
    metricValue: `${occurrences.length}/${evaluated}`,
    occurrences,
  };
}

function computeStaggeredDeathsInsight({ me, timeline }: CoachAnalysisInput): CoachInsightResult {
  const meta = {
    pillar: "staggeredDeaths" as const,
    icon: "i-heroicons-arrow-path-rounded-square",
    title: "Morts en décalé (Staggering)",
    methodology: `Pour chaque fight où ton équipe compte au moins 2 morts, on regarde si ta mort arrive plus de ${STAGGER_THRESHOLD_SECONDS}s après le premier décès allié du groupe -- signe d'un repli en ordre dispersé plutôt qu'un regroupement.`,
  };

  if (!timeline) {
    return {
      ...meta,
      status: "unavailable",
      reason: "Nécessite le timestamp de chaque mort du replay (SUnitDiedEvent) -- pas encore extrait par le pipeline d'ingestion.",
    };
  }

  const myDeaths = timeline.deaths.filter((d) => d.battletag === me.battletag);
  if (myDeaths.length === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: "Aucune mort ce match : rien à décaler." };
  }

  // Only deaths sharing a fight with >= 1 other teammate death are evaluated:
  // a lone death in its cluster has nothing to be staggered relative to.
  const { events, evaluated } = staggeredDeathEvents(timeline.deaths, subjectOf(me));
  const occurrences: CoachOccurrence[] = events.map((event) => ({
    atLabel: formatDuration(event.atSeconds),
    detail: `Mort ${event.delaySeconds.toFixed(0)}s après le premier coéquipier tombé dans ce fight.`,
  }));

  if (evaluated === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: `${myDeaths.length} mort(s), aucune ne partageait un fight avec un autre décès allié à comparer.` };
  }

  if (occurrences.length === 0) {
    return { ...meta, status: "ready", verdict: "positive", summary: `${evaluated} mort(s) en groupe évaluée(s), toujours dans les ${STAGGER_THRESHOLD_SECONDS}s du premier décès allié.` };
  }

  return {
    ...meta,
    status: "ready",
    verdict: "negative",
    summary: `${occurrences.length} mort(s) en groupe sur ${evaluated} en décalé, isolées après le reste de l'équipe.`,
    metricLabel: "Morts en décalé",
    metricValue: `${occurrences.length}/${evaluated}`,
    occurrences,
  };
}

function computeFirstDeathInsight({ me, timeline }: CoachAnalysisInput): CoachInsightResult {
  const meta = {
    pillar: "firstDeath" as const,
    icon: "i-heroicons-exclamation-circle",
    title: "Première mort de la partie",
    methodology: "Être le premier des 10 joueurs à mourir est une statistique fortement corrélée à la défaite dans le jeu compétitif -- une corrélation, pas un jugement sur la décision qui l'a causée.",
  };

  if (!timeline || timeline.deaths.length === 0) {
    return {
      ...meta,
      status: "unavailable",
      reason: "Nécessite le timestamp de chaque mort du replay (SUnitDiedEvent) -- pas encore extrait par le pipeline d'ingestion.",
    };
  }

  const first = firstDeathCount(timeline.deaths, subjectOf(me));
  const firstDeathAt = first.atSeconds!;

  if (first.isFirst) {
    return {
      ...meta,
      status: "ready",
      verdict: "negative",
      summary: `Tu es le premier tombé de la partie, à ${formatDuration(firstDeathAt)}.`,
      metricLabel: "Premier mort à",
      metricValue: formatDuration(firstDeathAt),
    };
  }

  return {
    ...meta,
    status: "ready",
    verdict: "positive",
    summary: `Tu n'es pas le premier tombé de la partie (à ${formatDuration(firstDeathAt)}).`,
  };
}

/** All 6 Coach pillars, in a fixed canonical order. Each entry is either a
 * computed verdict ("ready") or an honest "unavailable" placeholder when the
 * underlying replay data (`timeline`) hasn't been collected yet -- never a
 * fabricated number. See each pillar's `methodology` for its exact rule. */
export function buildCoachInsights(input: CoachAnalysisInput): CoachInsightResult[] {
  return [
    computeOutnumberedFightsInsight(input),
    computeTalentDelayInsight(input),
    computeStaggeredDeathsInsight(input),
    computeEfficiencyInsight(input),
    computeFirstDeathInsight(input),
    computeObjectiveFootprintInsight(input),
  ];
}
