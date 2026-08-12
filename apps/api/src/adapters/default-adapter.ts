import { replayPayloadSchema } from "@hots-stats/shared-types";
import type { z } from "zod";
import type { ParsedReplayData, ReplayAdapter } from "./types";

/** Raised by an adapter's `parse()` when the payload doesn't match its expected schema; carries the raw Zod error so callers can render field-level detail (`bun run check-build`'s console output, `POST /ingest`'s 400 response). */
export class ReplayValidationError extends Error {
  constructor(public readonly zodError: z.ZodError) {
    super("Replay payload failed schema validation");
    this.name = "ReplayValidationError";
  }
}

/**
 * Matches the JSON structure the daemon has always sent (`replayPayloadSchema`).
 * Most `heroprotocol` version bumps don't change this shape at all -- that's
 * exactly what `bun run check-build` exists to confirm for a new
 * `m_baseBuild` before trusting this adapter with it (see `registry.ts`).
 */
export const DefaultAdapter: ReplayAdapter = {
  name: "default",
  parse(rawData: unknown): ParsedReplayData {
    const result = replayPayloadSchema.safeParse(rawData);
    if (!result.success) {
      throw new ReplayValidationError(result.error);
    }
    return result.data;
  },
};
