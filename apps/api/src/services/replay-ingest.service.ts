import { DefaultAdapter, ReplayValidationError, resolveAdapter } from "../adapters";
import type { ReplayAdapter } from "../adapters";
import { quarantineRawReplay } from "./quarantine.service";
import type { UpsertResult } from "./replay-upsert.service";
import { upsertReplay } from "./replay-upsert.service";

export type IngestReplayResult =
  | { status: "invalid"; detail: unknown }
  | { status: "quarantined"; baseBuild: number }
  | ({ status: "processed" } & UpsertResult);

/** `m_baseBuild` is Blizzard's own replay header field name -- kept as-is at the top level of the payload rather than camelCased, so adapters can read it the same way regardless of what else changed in a given build's structure. */
function extractBaseBuild(body: Record<string, unknown>): number | null {
  const value = body.m_baseBuild;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Resolves the right adapter for a parsed-replay JSON payload (whichever
 * shape it came in with -- the daemon's own parser, or the web upload's
 * internal replay-parser service), upserts it, and reports what happened.
 *
 * Shared by `POST /ingest` (the daemon's Bearer-token flow, see
 * routes/ingest.ts) and `POST /uploads` (the logged-in web dropzone, see
 * routes/uploads.ts) so both go through the exact same adapter-resolution,
 * quarantine and upsert logic instead of drifting apart over time.
 */
export async function ingestReplayPayload(
  record: Record<string, unknown>,
  userId: string,
): Promise<IngestReplayResult> {
  const hasBaseBuild = "m_baseBuild" in record;
  const baseBuild = extractBaseBuild(record);
  if (hasBaseBuild && baseBuild === null) {
    return { status: "invalid", detail: "m_baseBuild must be an integer" };
  }

  // No `m_baseBuild` at all: a daemon version predating this feature --
  // always the default (and, until now, only) structure. A build number
  // *is* present goes through adapter resolution/quarantine below.
  let adapter: ReplayAdapter;
  if (baseBuild === null) {
    adapter = DefaultAdapter;
  } else {
    const resolved = await resolveAdapter(baseBuild);
    if (!resolved) {
      await quarantineRawReplay({ baseBuild, rawPayload: record, uploadedByUserId: userId });
      return { status: "quarantined", baseBuild };
    }
    adapter = resolved;
  }

  let parsed: ReturnType<ReplayAdapter["parse"]>;
  try {
    parsed = adapter.parse(record);
  } catch (err) {
    if (err instanceof ReplayValidationError) {
      return { status: "invalid", detail: err.zodError.flatten() };
    }
    throw err;
  }

  const result = await upsertReplay(parsed, userId);
  return { status: "processed", ...result };
}
