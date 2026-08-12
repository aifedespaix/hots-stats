import { db, knownBuilds } from "@hots-stats/db";
import { eq } from "drizzle-orm";
import { DefaultAdapter } from "./default-adapter";
import type { ReplayAdapter } from "./types";

/**
 * Hand-written adapters for `m_baseBuild`s whose JSON structure actually
 * diverges from `DefaultAdapter`'s. Populated as those builds get
 * investigated -- e.g. once `bun run check-build <id>` reports schema
 * errors, write an adapter for that shape and register it here:
 *
 *   79832: myBuild79832Adapter,
 *
 * A build listed here is used directly by `POST /ingest`, no `known_builds`
 * row needed -- the code *is* the confirmation.
 */
const CUSTOM_ADAPTERS: Record<number, ReplayAdapter> = {};

export function getCustomAdapter(baseBuild: number): ReplayAdapter | undefined {
  return CUSTOM_ADAPTERS[baseBuild];
}

/**
 * Picks the adapter for a given `m_baseBuild`, or `null` if the build
 * should be quarantined instead (no custom adapter registered, and not yet
 * confirmed compatible with `DefaultAdapter` via `bun run check-build`).
 *
 * Callers handling the "no `m_baseBuild` in the payload at all" case
 * (daemon versions that predate this feature) should use `DefaultAdapter`
 * directly rather than calling this -- that's not a build-resolution
 * question, see `routes/ingest.ts`.
 */
export async function resolveAdapter(baseBuild: number): Promise<ReplayAdapter | null> {
  const custom = getCustomAdapter(baseBuild);
  if (custom) return custom;

  const [known] = await db
    .select({ baseBuild: knownBuilds.baseBuild })
    .from(knownBuilds)
    .where(eq(knownBuilds.baseBuild, baseBuild))
    .limit(1);

  return known ? DefaultAdapter : null;
}
