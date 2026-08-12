import type { ReplayPayload } from "@hots-stats/shared-types";

/** Normalized shape every adapter must produce, regardless of the raw JSON structure it started from -- currently identical to the daemon's own payload shape (`ReplayPayload`), since that's what `upsertReplay` consumes. */
export type ParsedReplayData = ReplayPayload;

/**
 * Standard contract for turning a build-specific raw JSON payload into
 * `ParsedReplayData`. One adapter per `m_baseBuild` era whose structure
 * actually differs -- see `registry.ts` for how a build number picks an
 * adapter, and `default-adapter.ts` for the one matching today's structure.
 */
export interface ReplayAdapter {
  /** Identifies the adapter in logs/CLI output and `known_builds.verifiedBy`. */
  readonly name: string;
  /** Throws `ReplayValidationError` (see `default-adapter.ts`) when `rawData` doesn't match this adapter's expected shape. */
  parse(rawData: unknown): ParsedReplayData;
}
