import { z } from "zod";

export const daemonErrorTypeSchema = z.enum([
  "parse",
  "auth",
  "validation",
  "server",
  // Build the API doesn't recognise yet (QuarantinedError in the daemon).
  "quarantine",
  // Any WARNING/ERROR from the daemon's own logging outside the ingestion path.
  "runtime",
  // The daemon's `heroprotocol` is older than the API's `minHeroprotocolVersion`.
  "dependency",
]);
export type DaemonErrorType = z.infer<typeof daemonErrorTypeSchema>;

/**
 * Payload POSTed by the Python daemon to `POST /ingest/errors` (Bearer-authed,
 * same personal access token as `POST /ingest`) whenever `ingestion.py`'s
 * `ingest_file` records a local failure -- see that module's `_report_error`,
 * the single place this fires from. Best-effort on the daemon side (see
 * api_client.py's `post_ingest_error`): a failed error *report* must never
 * turn one ingestion failure into two.
 */
export const daemonErrorReportInputSchema = z.object({
  replayHash: z.string().min(32).nullable(),
  baseBuild: z.number().int().nonnegative().nullable(),
  errorType: daemonErrorTypeSchema,
  errorMessage: z.string().min(1).max(2000),
  errorLog: z.string().max(8000).nullable(),
  parserVersion: z.string().nullable(),
  daemonVersion: z.string().nullable(),
  heroprotocolVersion: z.string().max(64).nullable().optional(),
  // Stable hash of (type, normalised message, replayHash) computed by the daemon; lets the
  // server collapse repeats of a runtime error that has no replayHash to key on.
  fingerprint: z.string().min(8).max(64).nullable().optional(),
  // How many times the daemon saw this exact report since the last one it sent.
  occurrences: z.number().int().min(1).max(100000).default(1),
});
export type DaemonErrorReportInput = z.infer<typeof daemonErrorReportInputSchema>;
