#!/usr/bin/env bun
import { verifyQuarantinedBuild } from "../src/services/build-verification.service";

/**
 * `bun run check-build <buildId>` -- thin CLI wrapper around
 * `verifyQuarantinedBuild` (see `build-verification.service.ts` for the
 * actual logic, shared with `POST /_internal/quarantine/:buildId/verify`).
 */
async function main() {
  const buildArg = process.argv[2];
  const baseBuild = Number.parseInt(buildArg ?? "", 10);
  if (!buildArg || Number.isNaN(baseBuild)) {
    console.error("Usage: bun run check-build <buildId>");
    process.exit(1);
  }

  const result = await verifyQuarantinedBuild(baseBuild);
  if (result === null) {
    console.log(`No pending quarantined replays for build ${baseBuild}.`);
    return;
  }

  console.log(
    `Testing ${result.testedCount} quarantined replay(s) for build ${baseBuild} against DefaultAdapter...`,
  );

  if (!result.compatible) {
    console.error(
      `\n✗ Build ${baseBuild} is NOT compatible with DefaultAdapter ` +
        `(${result.failures.length}/${result.testedCount} replay(s) failed validation). A custom adapter is required.\n`,
    );
    for (const failure of result.failures) {
      console.error(`Replay ${failure.id}:`);
      console.error(JSON.stringify(failure.issues, null, 2));
    }
    process.exit(1);
  }

  console.log(`\n✓ Build ${baseBuild} is compatible with DefaultAdapter. Marked as verified.`);
  console.log(
    `Done: ${result.insertedCount}/${result.testedCount} quarantined replay(s) inserted into the main tables.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
