import { daemonIngestErrors, db } from "@hots-stats/db";
import type { DaemonErrorReportInput } from "@hots-stats/shared-types";
import { desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Records one daemon-reported ingestion failure (see `POST /ingest/errors`),
 * collapsing repeats of the same (user, replay) into a single row -- a
 * failing replay is retried on every daemon restart (see sync_state.py's
 * `is_up_to_date`), so without this the table would fill with duplicates of
 * the exact same failure instead of showing how persistent it is. Reopens a
 * previously `resolved` row: if it's failing again, whatever fix resolved it
 * before didn't actually stick (or a different bug now hits the same
 * replay).
 */
export async function recordDaemonError(userId: string, input: DaemonErrorReportInput): Promise<void> {
  const now = new Date();
  await db
    .insert(daemonIngestErrors)
    .values({
      userId,
      replayHash: input.replayHash,
      baseBuild: input.baseBuild,
      errorType: input.errorType,
      errorMessage: input.errorMessage,
      errorLog: input.errorLog,
      parserVersion: input.parserVersion,
      daemonVersion: input.daemonVersion,
      firstOccurredAt: now,
      lastOccurredAt: now,
    })
    .onConflictDoUpdate({
      target: [daemonIngestErrors.userId, daemonIngestErrors.replayHash],
      set: {
        baseBuild: input.baseBuild,
        errorType: input.errorType,
        errorMessage: input.errorMessage,
        errorLog: input.errorLog,
        parserVersion: input.parserVersion,
        daemonVersion: input.daemonVersion,
        status: "open",
        occurrenceCount: sql`${daemonIngestErrors.occurrenceCount} + 1`,
        lastOccurredAt: now,
        resolvedAt: null,
      },
    });
}

export interface DaemonErrorGroup {
  key: string;
  errorType: string;
  baseBuild: number | null;
  errorMessage: string;
  errorLog: string | null;
  parserVersion: string | null;
  daemonVersion: string | null;
  occurrences: number;
  affectedUsers: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  ids: string[];
}

/**
 * Open errors grouped by (errorType, baseBuild, errorMessage) -- the triage
 * view behind `GET /_internal/errors`: a bug that hits every player the same
 * way surfaces as one row with a high `occurrences`/`affectedUsers` count
 * instead of a page per replay. Grouped in application code (not SQL GROUP
 * BY) so each group can carry the row `ids` it's made of, for
 * `POST /_internal/errors/resolve` -- an aggregate query can compute counts
 * but can't also return "which rows contributed to them".
 */
export async function getDaemonErrorGroups(limit: number): Promise<DaemonErrorGroup[]> {
  const rows = await db
    .select({
      id: daemonIngestErrors.id,
      userId: daemonIngestErrors.userId,
      errorType: daemonIngestErrors.errorType,
      baseBuild: daemonIngestErrors.baseBuild,
      errorMessage: daemonIngestErrors.errorMessage,
      errorLog: daemonIngestErrors.errorLog,
      parserVersion: daemonIngestErrors.parserVersion,
      daemonVersion: daemonIngestErrors.daemonVersion,
      occurrenceCount: daemonIngestErrors.occurrenceCount,
      firstOccurredAt: daemonIngestErrors.firstOccurredAt,
      lastOccurredAt: daemonIngestErrors.lastOccurredAt,
    })
    .from(daemonIngestErrors)
    .where(eq(daemonIngestErrors.status, "open"))
    .orderBy(desc(daemonIngestErrors.lastOccurredAt))
    .limit(limit);

  const groups = new Map<string, DaemonErrorGroup & { userIds: Set<string> }>();
  for (const row of rows) {
    const key = `${row.errorType}:${row.baseBuild ?? "null"}:${row.errorMessage}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences += row.occurrenceCount;
      existing.ids.push(row.id);
      if (row.userId) existing.userIds.add(row.userId);
      if (row.firstOccurredAt < new Date(existing.firstOccurredAt)) {
        existing.firstOccurredAt = row.firstOccurredAt.toISOString();
      }
      if (row.lastOccurredAt > new Date(existing.lastOccurredAt)) {
        existing.lastOccurredAt = row.lastOccurredAt.toISOString();
        existing.errorLog = row.errorLog;
      }
    } else {
      groups.set(key, {
        key,
        errorType: row.errorType,
        baseBuild: row.baseBuild,
        errorMessage: row.errorMessage,
        errorLog: row.errorLog,
        parserVersion: row.parserVersion,
        daemonVersion: row.daemonVersion,
        occurrences: row.occurrenceCount,
        affectedUsers: 0,
        firstOccurredAt: row.firstOccurredAt.toISOString(),
        lastOccurredAt: row.lastOccurredAt.toISOString(),
        ids: [row.id],
        userIds: new Set(row.userId ? [row.userId] : []),
      });
    }
  }

  return [...groups.values()]
    .map(({ userIds, ...group }) => ({ ...group, affectedUsers: userIds.size }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

/** Marks a set of daemon error rows (one group's `ids`, from `getDaemonErrorGroups`) as resolved; returns how many rows were actually updated. */
export async function markDaemonErrorsResolved(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(daemonIngestErrors)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(inArray(daemonIngestErrors.id, ids))
    .returning({ id: daemonIngestErrors.id });
  return result.length;
}
