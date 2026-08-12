#!/usr/bin/env bun
import { DefaultAdapter, type ParsedReplayData, ReplayValidationError } from "../src/adapters";
import {
  getPendingQuarantinedReplays,
  markBuildVerified,
  markQuarantineFailed,
  markQuarantineProcessed,
} from "../src/services/quarantine.service";
import { upsertReplay } from "../src/services/replay-upsert.service";

/**
 * `bun run check-build <buildId>` -- most game updates don't change the
 * replay JSON structure at all, so before writing a bespoke adapter, check
 * whether `DefaultAdapter` already handles a quarantined build. Success
 * marks the build verified in `known_builds` and drains its quarantine
 * (see `apps/api/src/routes/ingest.ts` for what reads that verification).
 */
async function main() {
  const buildArg = process.argv[2];
  const baseBuild = Number.parseInt(buildArg ?? "", 10);
  if (!buildArg || Number.isNaN(baseBuild)) {
    console.error("Usage: bun run check-build <buildId>");
    process.exit(1);
  }

  const pending = await getPendingQuarantinedReplays(baseBuild);
  if (pending.length === 0) {
    console.log(`No pending quarantined replays for build ${baseBuild}.`);
    return;
  }

  console.log(`Testing ${pending.length} quarantined replay(s) for build ${baseBuild} against DefaultAdapter...`);

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
    console.error(
      `\n✗ Build ${baseBuild} is NOT compatible with DefaultAdapter ` +
        `(${failures.length}/${pending.length} replay(s) failed validation). A custom adapter is required.\n`,
    );
    for (const failure of failures) {
      console.error(`Replay ${failure.id}:`);
      console.error(JSON.stringify(failure.issues, null, 2));
      await markQuarantineFailed(failure.id, failure.issues);
    }
    process.exit(1);
  }

  console.log(`\n✓ Build ${baseBuild} is compatible with DefaultAdapter. Marking as verified...`);
  await markBuildVerified(baseBuild);

  let inserted = 0;
  for (const row of pending) {
    const parsed = parsedByRowId.get(row.id);
    if (!parsed) continue;
    // uploadedByUserId can go null after quarantine insert if the
    // uploading account was since deleted (`onDelete: "set null"`) --
    // nothing sane to attribute the match to, so leave it pending.
    if (!row.uploadedByUserId) {
      console.warn(`Skipping replay ${row.id}: uploading user no longer exists.`);
      continue;
    }
    await upsertReplay(parsed, row.uploadedByUserId);
    await markQuarantineProcessed(row.id);
    inserted++;
  }

  console.log(`Done: ${inserted}/${pending.length} quarantined replay(s) inserted into the main tables.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
