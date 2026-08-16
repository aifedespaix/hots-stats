import type { User } from "@hots-stats/db";
import { Hono } from "hono";
import { env } from "../lib/env";
import { authSession, requireUser } from "../middleware/auth-session";
import { ingestReplayPayload } from "../services/replay-ingest.service";
import { getAllCalibrations } from "../services/spatial-calibration.service";

type Env = { Variables: { user: User } };

type UploadOutcome =
  | { fileName: string; status: "uploaded"; matchId: string }
  | { fileName: string; status: "skipped"; matchId: string; reason?: string }
  | { fileName: string; status: "quarantined" }
  | { fileName: string; status: "error"; message: string };

// A big multi-season replay folder can be thousands of files; anything past
// this in one request is almost certainly a mistake (or worth batching client
// side) rather than something the parser service should be asked to eat in
// one go.
const MAX_FILES_PER_REQUEST = 50;
const REPLAY_EXTENSION = ".stormreplay";

/**
 * Forwards one raw `.StormReplay` file to the internal replay-parser service
 * (see apps/replay-parser) and returns the same JSON payload shape the
 * Windows daemon produces locally and posts to `POST /ingest` -- letting the
 * web dropzone reuse the exact same downstream adapter/upsert pipeline
 * (`ingestReplayPayload`) as the daemon, instead of a second, divergent one.
 *
 * `calibrations` (this request's `getAllCalibrations()` snapshot, fetched
 * once for the whole batch below) is forwarded as a JSON form field so
 * replay-parser can build a `spatial` block for a calibrated map, the same
 * way the daemon does with its own cached copy -- without this, a web
 * upload could never produce spatial data at all, calibrated map or not.
 */
async function parseWithReplayParser(
  file: File,
  calibrations: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("calibrations", JSON.stringify(calibrations));

  let response: Response;
  try {
    response = await fetch(`${env.REPLAY_PARSER_URL}/parse`, { method: "POST", body: form });
  } catch {
    throw new Error("Le service de parsing des replays est injoignable. Réessaie dans un instant.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: { message?: string } } | null;
    throw new Error(body?.detail?.message ?? `Le service de parsing a rejeté ce fichier (${response.status}).`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function asFileList(value: string | File | (string | File)[] | undefined): File[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry): entry is File => entry instanceof File);
}

/**
 * `POST /uploads` -- the manual "glisser-déposer" flow on `/upload`, called
 * directly by the logged-in browser session (cookie auth via `authSession`,
 * unlike `POST /ingest` which the daemon calls with its own Bearer token).
 * Accepts one or more `.StormReplay` files as `multipart/form-data` under the
 * `files` field and reports a per-file outcome, since a batch drop of a whole
 * replay folder can legitimately mix successes, dupes and bad files.
 */
export const uploadsRoute = new Hono<Env>()
  .use("*", authSession, requireUser)
  .post("/", async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.parseBody({ all: true }).catch(() => null);
    const files = asFileList(body?.files as string | File | (string | File)[] | undefined);

    if (files.length === 0) {
      return c.json({ error: "Aucun fichier reçu." }, 400);
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return c.json({ error: `Trop de fichiers en une seule fois (maximum ${MAX_FILES_PER_REQUEST}).` }, 400);
    }

    // Fetched once for the whole batch, not per-file -- a drag-and-drop of
    // a full replay folder can be dozens of files, and calibrations don't
    // change mid-request.
    const calibrations = await getAllCalibrations();

    const results: UploadOutcome[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(REPLAY_EXTENSION)) {
        results.push({ fileName: file.name, status: "error", message: "Ce n'est pas un fichier .StormReplay." });
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = await parseWithReplayParser(file, calibrations);
      } catch (err) {
        results.push({
          fileName: file.name,
          status: "error",
          message: err instanceof Error ? err.message : "Échec du parsing du replay.",
        });
        continue;
      }

      const outcome = await ingestReplayPayload(payload, user.id);
      switch (outcome.status) {
        case "invalid":
          results.push({ fileName: file.name, status: "error", message: "Replay parsé mais rejeté par le serveur." });
          break;
        case "quarantined":
          results.push({ fileName: file.name, status: "quarantined" });
          break;
        case "processed":
          results.push(
            outcome.upserted
              ? { fileName: file.name, status: "uploaded", matchId: outcome.matchId }
              : { fileName: file.name, status: "skipped", matchId: outcome.matchId, reason: outcome.reason },
          );
          break;
      }
    }

    return c.json({ results });
  });
