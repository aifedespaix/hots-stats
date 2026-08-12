import { verifyQuarantinedBuild } from "../services/build-verification.service";
import { getQuarantineOverview } from "../services/quarantine.service";

const _SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `verifyQuarantinedBuild` for every `m_baseBuild` currently sitting in
 * `raw_replays_quarantine` -- the same thing `bun run check-build <id>` (or
 * `POST /_internal/quarantine/:buildId/verify`) does by hand, just on a
 * schedule instead of waiting for someone to notice a build piling up. Most
 * Heroes of the Storm patches don't change the replay JSON structure at all,
 * so this is expected to silently drain the common case; a build that fails
 * validation stays quarantined (rows marked `failed`, visible via
 * `GET /_internal/quarantine/:buildId`) for a hand-written adapter, which
 * still needs a person (or Claude) to write -- this sweep only automates the
 * "is it actually different" check, not adapter authorship.
 */
async function runQuarantineVerificationSweep(): Promise<void> {
  const overview = await getQuarantineOverview();
  const pending = overview.filter((build) => build.pendingCount > 0);
  if (pending.length === 0) return;

  console.log(`[quarantine-verification] checking ${pending.length} build(s) with pending replays...`);
  for (const build of pending) {
    try {
      const result = await verifyQuarantinedBuild(build.baseBuild);
      if (result === null) continue;
      if (result.compatible) {
        console.log(
          `[quarantine-verification] build ${result.baseBuild}: compatible, drained ${result.insertedCount}/${result.testedCount} replay(s).`,
        );
      } else {
        console.warn(
          `[quarantine-verification] build ${result.baseBuild}: NOT compatible with DefaultAdapter ` +
            `(${result.failures.length}/${result.testedCount} failed validation) -- needs a custom adapter, see registry.ts.`,
        );
      }
    } catch (err) {
      // One build's DB hiccup shouldn't cancel the rest of the sweep, and
      // must never take down the API process it's running alongside.
      console.error(`[quarantine-verification] build ${build.baseBuild}: sweep failed`, err);
    }
  }
}

/**
 * Starts the recurring sweep on the API's own process (see `index.ts`) --
 * no separate container/cron needed, since `bun run apps/api/dist/index.js`
 * already runs as a single long-lived process on the deployment (see
 * `docker-entrypoint.sh`). Fires once shortly after boot (migrations have
 * already run by the time this module loads, per the entrypoint script) and
 * every `_SWEEP_INTERVAL_MS` after that.
 */
export function startQuarantineVerificationJob(): void {
  void runQuarantineVerificationSweep().catch((err) =>
    console.error("[quarantine-verification] initial sweep failed", err),
  );
  setInterval(() => {
    void runQuarantineVerificationSweep().catch((err) =>
      console.error("[quarantine-verification] sweep failed", err),
    );
  }, _SWEEP_INTERVAL_MS);
}
