import { db, knownBuilds, rawReplaysQuarantine } from "@hots-stats/db";
import { and, desc, eq, sql } from "drizzle-orm";

/** Inserts a raw ingestion payload for a build we don't have an adapter for yet -- see `raw_replays_quarantine`. */
export async function quarantineRawReplay(params: {
  baseBuild: number;
  rawPayload: unknown;
  uploadedByUserId: string;
}) {
  await db.insert(rawReplaysQuarantine).values({
    baseBuild: params.baseBuild,
    rawPayload: params.rawPayload,
    uploadedByUserId: params.uploadedByUserId,
  });
}

/**
 * One row per `baseBuild` currently holding quarantined replays, for
 * `GET /_internal/quarantine` -- the discovery step before
 * `GET /_internal/quarantine/:buildId` (which needs a build id to already be
 * known) or `bun run check-build <id>` can be used at all.
 */
export async function getQuarantineOverview() {
  return db
    .select({
      baseBuild: rawReplaysQuarantine.baseBuild,
      pendingCount: sql<number>`count(*) filter (where ${rawReplaysQuarantine.status} = 'pending')::int`,
      failedCount: sql<number>`count(*) filter (where ${rawReplaysQuarantine.status} = 'failed')::int`,
      firstReceivedAt: sql<string>`min(${rawReplaysQuarantine.receivedAt})`,
      lastReceivedAt: sql<string>`max(${rawReplaysQuarantine.receivedAt})`,
    })
    .from(rawReplaysQuarantine)
    .groupBy(rawReplaysQuarantine.baseBuild)
    .orderBy(desc(sql`max(${rawReplaysQuarantine.receivedAt})`));
}

/** Newest `limit` raw payloads quarantined for a build, for `GET /_internal/quarantine/:buildId` structure comparisons. */
export async function getQuarantineSamples(baseBuild: number, limit: number) {
  return db
    .select()
    .from(rawReplaysQuarantine)
    .where(eq(rawReplaysQuarantine.baseBuild, baseBuild))
    .orderBy(desc(rawReplaysQuarantine.receivedAt))
    .limit(limit);
}

/** Every replay for a build still awaiting a working adapter, for `bun run check-build`. */
export async function getPendingQuarantinedReplays(baseBuild: number) {
  return db
    .select()
    .from(rawReplaysQuarantine)
    .where(and(eq(rawReplaysQuarantine.baseBuild, baseBuild), eq(rawReplaysQuarantine.status, "pending")));
}

export async function markQuarantineProcessed(id: string) {
  await db
    .update(rawReplaysQuarantine)
    .set({ status: "processed", processedAt: new Date(), errorDetails: null })
    .where(eq(rawReplaysQuarantine.id, id));
}

export async function markQuarantineFailed(id: string, errorDetails: unknown) {
  await db
    .update(rawReplaysQuarantine)
    .set({ status: "failed", processedAt: new Date(), errorDetails })
    .where(eq(rawReplaysQuarantine.id, id));
}

/** Records a build as confirmed compatible with `DefaultAdapter` — see `known_builds`. */
export async function markBuildVerified(baseBuild: number, verifiedBy = "check-build-cli") {
  await db.insert(knownBuilds).values({ baseBuild, verifiedBy }).onConflictDoNothing();
}
