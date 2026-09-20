import type { MatchObjectiveEvent, ObjectiveEventKind } from "@hots-stats/shared-types";
import type { MatchTimelineTeamLabels } from "~/types/coach";

/**
 * French label for every objective kind the daemon can emit. Typed as a
 * Record<ObjectiveEventKind, string> so adding a kind to the shared enum
 * without a label is a compile error, not a silent raw slug on screen.
 */
export const OBJECTIVE_KIND_LABELS: Record<ObjectiveEventKind, string> = {
  mercenaryCamp: "Camp mercenaire",
  dragonKnight: "Chevalier dragon",
  tribute: "Tribut",
  curse: "Malédiction",
  templeCaptured: "Temple capturé",
  templeActivated: "Temple activé",
  altarCaptured: "Autel capturé",
  townCaptured: "Ville capturée",
  ghostShipCaptured: "Navire fantôme capturé",
  nukeCollected: "Nuke récupérée",
  nukeFired: "Nuke tirée",
  nukeDropped: "Nuke lâchée",
  golemsSpawned: "Golems de la mine",
  capturePoint: "Point de capture",
  shrineCaptured: "Sanctuaire capturé",
  punisherKilled: "Punisseur tué",
  soulEatersSpawned: "Dévoreurs d'âmes",
  immortalDefeated: "Immortel vaincu",
  sixTownStart: "Événement des six villes",
};

/** Falls back to the raw slug for a kind this build predates, so an unknown
 * objective never blanks the list. */
export function objectiveKindLabel(kind: string): string {
  return (OBJECTIVE_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/** "Camp mercenaire · Siege Camp", or just the label when there is no detail. */
export function objectiveEventLabel(event: MatchObjectiveEvent): string {
  const label = objectiveKindLabel(event.kind);
  return event.detail ? label + " · " + event.detail : label;
}

/** Which side captured it, in the same words the chronology uses. */
export function objectiveSideLabel(team: 0 | 1 | null, labels: MatchTimelineTeamLabels): string {
  if (team === 0) return labels.team0;
  if (team === 1) return labels.team1;
  return "équipe inconnue";
}
