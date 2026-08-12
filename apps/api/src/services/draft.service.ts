import { db, draftPseudoPreferences, heroes, matchPlayers, matches, users } from "@hots-stats/db";
import {
  DRAFT_MIN_RANKED_GAMES_FOR_RANKING,
  DRAFT_RANKED_MODES,
  type DraftHeroStat,
  type DraftPlayerSlot,
  type DraftPlayerStats,
  type DraftSlotInput,
  type DraftSnapshot,
  type DraftSnapshotInput,
} from "@hots-stats/shared-types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getPlayerEncounter } from "./players.service";

/**
 * Everything the live-draft feature needs beyond a plain DB query: a draft
 * is a *pre-game* curiosity, not a stat worth persisting, so state here is
 * process-memory only (single API instance -- see README's Raspberry Pi
 * deployment) and expires on its own. The one thing that *is* persisted is
 * `draft_pseudo_preferences`, since remembering "this bare pseudo means that
 * battletag" is worth keeping across restarts/reconnects for the viewer who
 * set it.
 */

const DRAFT_SNAPSHOT_TTL_MS = 45 * 60 * 1000;

interface ResolvedSlot extends DraftSlotInput {
  /** Every full battletag whose name part (before `#`) matches `rawName`,
   * across every match ever recorded -- see `resolveCandidates`. */
  candidates: string[];
}

interface StoredSnapshot {
  id: string;
  capturedAt: string;
  teamLeft: ResolvedSlot[];
  teamRight: ResolvedSlot[];
  createdAtMs: number;
}

export interface DraftEventSink {
  send: (snapshot: DraftSnapshot) => Promise<void>;
}

// Keyed by the *recipient* user id: one draft can fan out to several
// registered accounts (every teammate/opponent the app recognizes), each
// with their own SSE connection(s) and their own view of ambiguous slots.
const latestSnapshotByUserId = new Map<string, StoredSnapshot>();
const subscribersByUserId = new Map<string, Set<DraftEventSink>>();

/** Every full battletag in `match_players` whose name part matches `rawName`
 * case-insensitively. HotS never shows battletags on the draft screen, only
 * the bare display name, so this is the only way to turn OCR output back
 * into something `match_players.battletag` can be queried by. */
async function resolveCandidates(rawName: string): Promise<string[]> {
  const pseudo = rawName.trim();
  if (!pseudo) return [];

  const rows = await db
    .selectDistinct({ battletag: matchPlayers.battletag })
    .from(matchPlayers)
    .where(sql`lower(split_part(${matchPlayers.battletag}, '#', 1)) = lower(${pseudo})`);

  return rows.map((row) => row.battletag);
}

async function loadPreferences(viewerUserId: string, pseudos: string[]): Promise<Map<string, string>> {
  if (pseudos.length === 0) return new Map();

  const rows = await db
    .select({ pseudo: draftPseudoPreferences.pseudo, chosenBattletag: draftPseudoPreferences.chosenBattletag })
    .from(draftPseudoPreferences)
    .where(
      and(eq(draftPseudoPreferences.viewerUserId, viewerUserId), inArray(draftPseudoPreferences.pseudo, pseudos)),
    );

  return new Map(rows.map((row) => [row.pseudo, row.chosenBattletag]));
}

/** Applies one viewer's remembered preferences to a shared, resolved
 * snapshot -- two viewers can see the same ambiguous pseudo and mean two
 * different battletags, so this can't be baked into `StoredSnapshot` itself. */
async function toViewerSnapshot(viewerUserId: string, stored: StoredSnapshot): Promise<DraftSnapshot> {
  const ambiguousPseudos = [...stored.teamLeft, ...stored.teamRight]
    .filter((slot) => slot.candidates.length > 1 && slot.rawName)
    .map((slot) => slot.rawName!.trim().toLowerCase());
  const preferences = await loadPreferences(viewerUserId, [...new Set(ambiguousPseudos)]);

  function resolveSlot(slot: ResolvedSlot): DraftPlayerSlot {
    let effectiveBattletag: string | null = null;
    if (slot.candidates.length === 1) {
      effectiveBattletag = slot.candidates[0]!;
    } else if (slot.candidates.length > 1 && slot.rawName) {
      const preferred = preferences.get(slot.rawName.trim().toLowerCase());
      effectiveBattletag = preferred && slot.candidates.includes(preferred) ? preferred : null;
    }
    return {
      slot: slot.slot,
      rawName: slot.rawName,
      status: slot.status,
      candidates: slot.candidates,
      effectiveBattletag,
    };
  }

  return {
    id: stored.id,
    capturedAt: stored.capturedAt,
    teamLeft: stored.teamLeft.map(resolveSlot),
    teamRight: stored.teamRight.map(resolveSlot),
  };
}

/** Every distinct, normalized name read successfully (`status: "ok"`) across
 * both teams of a snapshot -- pooled rather than kept per-team/per-slot
 * because a 5-stack can queue again and land on the *other* side, so
 * "did the roster change" has to be judged across all 10 slots at once,
 * not team-by-team. */
function pooledNames(snapshot: Pick<StoredSnapshot, "teamLeft" | "teamRight">): Set<string> {
  const names = new Set<string>();
  for (const slot of [...snapshot.teamLeft, ...snapshot.teamRight]) {
    if (slot.status === "ok" && slot.rawName) names.add(slot.rawName.trim().toLowerCase());
  }
  return names;
}

/** A new draft only ever *adds* players HotS hasn't shown this viewer
 * before in the current one -- players never change slot mid-draft. So a
 * capture introducing a name absent from what's already stored means the
 * hotkey was pressed on a genuinely new draft (even a 5-stack replaying
 * together shows at least the 5 new opponents), while a capture that reads
 * back only names already known is either a retry on the same draft or a
 * bad capture (menu, loading screen) that must not be treated as one. */
function isNewGame(existing: StoredSnapshot, incoming: StoredSnapshot): boolean {
  const existingNames = pooledNames(existing);
  for (const name of pooledNames(incoming)) {
    if (!existingNames.has(name)) return true;
  }
  return false;
}

/** Slot-by-slot: a fresh "ok" read replaces (and can correct) what's there,
 * but a slot the new capture couldn't read keeps whatever the previous
 * capture had for that same team+slot, rather than regressing it to
 * unreadable. */
function mergeTeam(existingTeam: ResolvedSlot[], incomingTeam: ResolvedSlot[]): ResolvedSlot[] {
  return incomingTeam.map((incoming, index) => {
    if (incoming.status === "ok" && incoming.rawName) return incoming;
    return existingTeam[index] ?? incoming;
  });
}

/**
 * Decides what to actually persist/publish for one recipient of a new
 * capture: a wholesale replacement for a new draft (or when nothing usable
 * is on record yet), otherwise a merge that never lets a bad capture --
 * hotkey pressed on the menu, loading screen, or a mid-draft retry that
 * partially fails OCR -- erase names this viewer's client already has.
 * `incoming`'s `id`/`capturedAt` are always kept so the snapshot stays
 * "fresh" (and its SSE TTL keeps extending) even on a merge.
 */
function reconcileSnapshot(existing: StoredSnapshot | undefined, incoming: StoredSnapshot): StoredSnapshot {
  if (!existing || Date.now() - existing.createdAtMs > DRAFT_SNAPSHOT_TTL_MS || isNewGame(existing, incoming)) {
    return incoming;
  }
  return {
    ...incoming,
    teamLeft: mergeTeam(existing.teamLeft, incoming.teamLeft),
    teamRight: mergeTeam(existing.teamRight, incoming.teamRight),
  };
}

async function publish(userId: string, stored: StoredSnapshot): Promise<void> {
  const sinks = subscribersByUserId.get(userId);
  if (!sinks || sinks.size === 0) return;

  const payload = await toViewerSnapshot(userId, stored);
  await Promise.all(
    [...sinks].map(async (sink) => {
      try {
        await sink.send(payload);
      } catch {
        // The connection is dead; the route's abort handler will also call
        // the unsubscribe function returned by `subscribeToDraftUpdates`,
        // this just stops a dead sink from being retried in the meantime.
        sinks.delete(sink);
      }
    }),
  );
}

/**
 * Entry point for `POST /draft/snapshot`: resolves every slot's bare pseudo
 * to candidate battletags, works out who should see this draft (every
 * registered account among the candidates, plus whoever's daemon submitted
 * it), and pushes it to each of them live -- this is what makes Player B's
 * tab update when Player A triggers the capture and they're both in the
 * same game.
 */
export async function ingestDraftSnapshot(submitterUserId: string, input: DraftSnapshotInput): Promise<void> {
  const allSlots = [...input.teamLeft, ...input.teamRight];
  const resolvedSlots: ResolvedSlot[] = await Promise.all(
    allSlots.map(async (slot) => ({
      ...slot,
      candidates: slot.status === "ok" && slot.rawName ? await resolveCandidates(slot.rawName) : [],
    })),
  );

  const candidateBattletags = [...new Set(resolvedSlots.flatMap((slot) => slot.candidates))];
  const matchedUsers =
    candidateBattletags.length > 0
      ? await db.select({ id: users.id }).from(users).where(inArray(users.battletag, candidateBattletags))
      : [];

  const audience = new Set<string>([submitterUserId, ...matchedUsers.map((row) => row.id)]);

  const incoming: StoredSnapshot = {
    id: crypto.randomUUID(),
    capturedAt: input.capturedAt,
    teamLeft: resolvedSlots.slice(0, 5),
    teamRight: resolvedSlots.slice(5, 10),
    createdAtMs: Date.now(),
  };

  await Promise.all(
    [...audience].map(async (userId) => {
      // Reconciled per recipient, not shared: two viewers of the same draft
      // can each have a different (or no) snapshot already on record.
      const stored = reconcileSnapshot(latestSnapshotByUserId.get(userId), incoming);
      latestSnapshotByUserId.set(userId, stored);
      await publish(userId, stored);
    }),
  );
}

/** Sent immediately when a viewer's SSE connection opens, so a page loaded
 * *after* the draft was captured still shows it instead of the empty state. */
export async function getCurrentSnapshotForViewer(viewerUserId: string): Promise<DraftSnapshot | null> {
  const stored = latestSnapshotByUserId.get(viewerUserId);
  if (!stored) return null;
  if (Date.now() - stored.createdAtMs > DRAFT_SNAPSHOT_TTL_MS) {
    latestSnapshotByUserId.delete(viewerUserId);
    return null;
  }
  return toViewerSnapshot(viewerUserId, stored);
}

/** Registers an SSE sink for live pushes; the returned function must be
 * called when the connection closes (route's abort signal) to avoid leaking
 * dead sinks. */
export function subscribeToDraftUpdates(userId: string, sink: DraftEventSink): () => void {
  let sinks = subscribersByUserId.get(userId);
  if (!sinks) {
    sinks = new Set();
    subscribersByUserId.set(userId, sinks);
  }
  sinks.add(sink);
  return () => {
    sinks!.delete(sink);
    if (sinks!.size === 0) subscribersByUserId.delete(userId);
  };
}

export async function setDraftPseudoPreference(
  viewerUserId: string,
  pseudo: string,
  battletag: string,
): Promise<void> {
  const normalized = pseudo.trim().toLowerCase();
  await db
    .insert(draftPseudoPreferences)
    .values({ viewerUserId, pseudo: normalized, chosenBattletag: battletag })
    .onConflictDoUpdate({
      target: [draftPseudoPreferences.viewerUserId, draftPseudoPreferences.pseudo],
      set: { chosenBattletag: battletag, updatedAt: new Date() },
    });
}

/**
 * Per-battletag hero stats for the draft "stats" panel, deliberately *not*
 * scoped to the connected viewer's own matches (unlike
 * `players.service.ts`'s `getPlayerHeroBreakdown`) -- these describe the
 * selected player, computed from every ranked match they've ever appeared
 * in across the whole app, regardless of who uploaded it.
 */
export async function getPlayerDraftStats(viewerUserId: string, battletag: string): Promise<DraftPlayerStats> {
  const [encounter, heroRows] = await Promise.all([
    getPlayerEncounter(viewerUserId, battletag),
    db
      .select({
        heroId: matchPlayers.heroId,
        heroName: heroes.name,
        gamesPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matchPlayers.winner})::int`,
        avgKills: sql<number>`coalesce(avg(${matchPlayers.kills}), 0)::float`,
        avgDeaths: sql<number>`coalesce(avg(${matchPlayers.deaths}), 0)::float`,
        avgAssists: sql<number>`coalesce(avg(${matchPlayers.assists}), 0)::float`,
      })
      .from(matchPlayers)
      .innerJoin(heroes, eq(heroes.id, matchPlayers.heroId))
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(and(eq(matchPlayers.battletag, battletag), inArray(matches.gameMode, [...DRAFT_RANKED_MODES])))
      .groupBy(matchPlayers.heroId, heroes.name),
  ]);

  const heroStats: DraftHeroStat[] = heroRows.map((row) => ({
    ...row,
    winrate: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
    kda: (row.avgKills + row.avgAssists) / Math.max(1, row.avgDeaths),
  }));

  const topPlayed = [...heroStats].sort((a, b) => b.gamesPlayed - a.gamesPlayed).slice(0, 3);

  const eligible = heroStats.filter((hero) => hero.gamesPlayed >= DRAFT_MIN_RANKED_GAMES_FOR_RANKING);
  const topWinrate = [...eligible].sort((a, b) => b.winrate - a.winrate).slice(0, 3);
  const topKda = [...eligible].sort((a, b) => b.kda - a.kda).slice(0, 2);

  return {
    battletag,
    encounters: encounter?.gamesTogether ?? 0,
    rankedGamesTotal: heroStats.reduce((sum, hero) => sum + hero.gamesPlayed, 0),
    topPlayed,
    topWinrate,
    topKda,
  };
}
