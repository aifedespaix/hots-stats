import { DefaultAdapter, type ParsedReplayData, ReplayValidationError } from "../adapters";
import { upsertReplay } from "./replay-upsert.service";
import {
  getPendingQuarantinedReplays,
  markBuildVerified,
  markQuarantineFailed,
  markQuarantineProcessed,
} from "./quarantine.service";

export interface QuarantineVerificationResult {
  baseBuild: number;
  compatible: boolean;
  testedCount: number;
  insertedCount: number;
  failures: { id: string; issues: unknown }[];
}

/**
 * Tests every pending quarantined replay for `baseBuild` against
 * `DefaultAdapter`: most game updates don't change the replay JSON
 * structure at all, so this is what decides whether a build actually needs
 * a hand-written adapter before writing one. On success, marks the build
 * verified (`known_builds`) and drains its quarantine into `matches`/
 * `match_players`, same as `apps/api/scripts/check-build.ts`, which is a
 * thin CLI wrapper around this -- extracted here so the same logic is also
 * reachable over HTTP via `POST /_internal/quarantine/:buildId/verify`,
 * for triaging a build without shell/DB access to the deployment.
 *
 * Returns `null` if there's nothing quarantined for this build at all.
 */
export async function verifyQuarantinedBuild(baseBuild: number): Promise<QuarantineVerificationResult | null> {
  const pending = await getPendingQuarantinedReplays(baseBuild);
  if (pending.length === 0) return null;

  const parsedByRowId = new Map<string, ParsedReplayData>();
  const failures: { id: string; issues: unknown }[] = [];

  for (const row of pending) {
    try {
      parsedByRowId.set(row.id, DefaultAdapter.parse(row.rawPayload));
    } catch (err) {
      if (!(err instanceof ReplayValidationError)) throw err;
      failures.push({ id: row.id, issues: err.zodError.flatten() });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      await markQuarantineFailed(failure.id, failure.issues);
    }
    return { baseBuild, compatible: false, testedCount: pending.length, insertedCount: 0, failures };
  }

  await markBuildVerified(baseBuild);

  let inserted = 0;
  for (const row of pending) {
    const parsed = parsedByRowId.get(row.id);
    if (!parsed) continue;
    // uploadedByUserId can go null after quarantine insert if the
    // uploading account was since deleted (`onDelete: "set null"`) --
    // nothing sane to attribute the match to, so leave it pending.
    if (!row.uploadedByUserId) continue;
    await upsertReplay(parsed, row.uploadedByUserId);
    await markQuarantineProcessed(row.id);
    inserted++;
  }

  return { baseBuild, compatible: true, testedCount: pending.length, insertedCount: inserted, failures: [] };
}
