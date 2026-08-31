"""Thin HTTP client for POSTing parsed replay payloads to the ingestion API."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import requests

from .config import Config

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 4
_BACKOFF_SECONDS = 2.0
_TIMEOUT_SECONDS = 30


class ApiClientError(Exception):
    """Base class for ingestion API errors."""


class AuthError(ApiClientError):
    """The access token was rejected (401): invalid or revoked."""


class ValidationError(ApiClientError):
    """The server rejected the payload (400), e.g. a Zod validation error."""

    def __init__(self, message: str, detail: object) -> None:
        super().__init__(message)
        self.detail = detail


class QuarantinedError(ApiClientError):
    """The server doesn't yet recognize this replay's game build
    (`m_baseBuild`) and has quarantined it server-side for review instead of
    ingesting it (see apps/api/src/routes/ingest.ts, the `resolveAdapter`
    branch, and `raw_replays_quarantine`). Not retried within `post_replay`
    since resending the same build won't change the outcome -- but
    `ingest_file` still records it as a retryable local error, since this is
    expected to start succeeding on its own once someone verifies the build
    server-side (`bun run check-build`) and the next sync attempt picks up
    the same replay again.
    """

    def __init__(self, message: str, base_build: int | None) -> None:
        super().__init__(message)
        self.base_build = base_build


@dataclass(frozen=True)
class IngestResult:
    upserted: bool
    match_id: str
    reason: str | None = None


class ApiClient:
    def __init__(self, config: Config) -> None:
        self._base_url = config.api_base_url
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"Bearer {config.access_token}"

    def post_replay(self, payload: dict) -> IngestResult:
        """POSTs a replay payload, retrying on network errors and 5xx responses.

        The daemon's PC can be offline or the API can be briefly unavailable;
        malformed-payload (400) and auth (401) failures are not retried since
        retrying won't change the outcome.
        """
        last_error: Exception | None = None

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = self._session.post(
                    f"{self._base_url}/ingest", json=payload, timeout=_TIMEOUT_SECONDS
                )
            except requests.RequestException as err:
                last_error = err
                logger.warning("Ingest request failed (attempt %d/%d): %s", attempt, _MAX_ATTEMPTS, err)
            else:
                if response.status_code == 401:
                    raise AuthError("Access token was rejected (invalid or revoked).")
                if response.status_code == 400:
                    detail = _safe_json(response)
                    raise ValidationError("Server rejected the replay payload.", detail)
                if response.status_code < 500:
                    response.raise_for_status()
                    body = response.json()
                    if body.get("quarantined"):
                        # 202 with `{quarantined: true, baseBuild}` -- no
                        # `upserted`/`matchId` keys, unlike every other
                        # sub-500 response this endpoint returns. Must be
                        # checked before the `body["upserted"]` access below,
                        # which would otherwise raise a bare KeyError here.
                        base_build = body.get("baseBuild")
                        raise QuarantinedError(
                            "Server does not yet recognize this replay's game build "
                            f"({base_build}); it has been quarantined server-side for "
                            "review and will sync automatically once the build is verified.",
                            base_build,
                        )
                    return IngestResult(
                        upserted=body["upserted"],
                        match_id=body["matchId"],
                        reason=body.get("reason"),
                    )
                last_error = ApiClientError(f"Server error {response.status_code}: {_safe_json(response)}")
                logger.warning("Ingest request failed (attempt %d/%d): %s", attempt, _MAX_ATTEMPTS, last_error)

            if attempt < _MAX_ATTEMPTS:
                time.sleep(_BACKOFF_SECONDS * (2 ** (attempt - 1)))

        assert last_error is not None
        raise ApiClientError(f"Failed to reach the ingestion API after {_MAX_ATTEMPTS} attempts") from last_error

    def post_draft_snapshot(self, payload: dict, timeout: float = 10.0) -> bool:
        """POSTs a live-draft snapshot. Unlike `post_replay`, this is
        time-sensitive -- the draft is happening right now -- so it's a
        single best-effort attempt rather than a retrying one: by the time a
        multi-attempt backoff would succeed, the draft the player wanted to
        see stats for is probably long over. Returns whether it succeeded;
        never raises, since a failed capture must never crash the daemon's
        hotkey callback (see draft_capture.py)."""
        try:
            response = self._session.post(f"{self._base_url}/draft/snapshot", json=payload, timeout=timeout)
        except requests.RequestException as err:
            logger.warning("Failed to submit draft snapshot: %s", err)
            return False

        if response.status_code >= 400:
            logger.warning("Draft snapshot rejected (%d): %s", response.status_code, _safe_json(response))
            return False
        return True

    def post_samples(self, map_id: str, points: list[dict], timeout: float = 10.0) -> bool:
        """POSTs a map's raw calibration sample points to `/spatial/samples`.
        Single best-effort attempt, same as `post_draft_snapshot`/
        `post_ingest_error`: this is a diagnostic side-channel, not the real
        replay upload -- a failure here must never turn a successful parse
        into a reported ingestion failure (see ingestion.py's `ingest_file`,
        the only caller). Logged at `debug`/`warning`, deliberately never
        `error`, so it never reads like a real ingestion problem in the
        Debug window."""
        try:
            response = self._session.post(
                f"{self._base_url}/spatial/samples",
                json={"mapId": map_id, "points": points},
                timeout=timeout,
            )
        except requests.RequestException as err:
            logger.debug("Failed to submit calibration sample for %r: %s", map_id, err)
            return False

        if response.status_code >= 400:
            logger.warning(
                "Calibration sample for %r rejected (%d): %s", map_id, response.status_code, _safe_json(response)
            )
            return False
        return True

    def post_ingest_error(self, report: dict, timeout: float = 10.0) -> bool:
        """POSTs one local ingestion failure to `/ingest/errors`, so it's
        triageable centrally instead of only visible in this one player's own
        Debug window -- see ingestion.py's `_report_error`, the only caller.
        Single best-effort attempt, same as `post_draft_snapshot`: never
        raises and isn't retried, since a failed *error report* must not
        itself become a second failure for the sync loop to handle, and the
        underlying failure is already recorded locally (sync_state.py's
        `mark_error`) regardless of whether this call succeeds."""
        try:
            response = self._session.post(f"{self._base_url}/ingest/errors", json=report, timeout=timeout)
        except requests.RequestException as err:
            logger.debug("Failed to report ingestion error to the API: %s", err)
            return False

        if response.status_code >= 400:
            logger.debug("Ingestion error report rejected (%d): %s", response.status_code, _safe_json(response))
            return False
        return True


def _safe_json(response: requests.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return response.text


# --- Lightweight, non-retrying helpers for the settings window -------------
#
# These back the live green/red status indicators in gui.py. Unlike
# `ApiClient.post_replay` (used for real ingestion), they fail fast and
# silently: a flaky connection while the user is mid-typing should just show
# a red dot, not retry with backoff and block the UI.


def ping_health(base_url: str, timeout: float = 3.0) -> bool:
    """True iff `GET {base_url}/health` responds 200. Used to validate the
    API Base URL field without needing a token."""
    try:
        response = requests.get(f"{base_url.rstrip('/')}/health", timeout=timeout)
    except requests.RequestException:
        return False
    return response.status_code == 200


def fetch_version(base_url: str, access_token: str, timeout: float = 5.0) -> dict | None:
    """Best-effort `GET {base_url}/ingest/version` fetch: `{"apiVersion":
    ..., "minParserVersion": ...}`. Used both at daemon startup (to decide
    whether previously-synced replays need reprocessing -- see app.py's
    `_sync_api_version` and `sync_state.invalidate_stale`) and in the
    settings window (to display the API's version). Returns None on any
    failure; callers must treat that as "unknown", not "API wants nothing
    resynced" -- see `_sync_api_version`, which leaves existing sync state
    untouched in that case."""
    try:
        response = requests.get(
            f"{base_url.rstrip('/')}/ingest/version",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=timeout,
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def fetch_calibrations(base_url: str, access_token: str, timeout: float = 5.0) -> dict[str, dict] | None:
    """Best-effort `GET {base_url}/spatial/calibrations/by-layer` fetch:
    `{mapId: {layerKey: {minX, maxX, minY, maxY, updatedAt}}}` for every
    calibrated map, one inner entry per calibrated layer (`""` = a map's
    default/only level). Deliberately hits the `/by-layer` path, not the
    legacy `/spatial/calibrations` (which serves the older flat, default-
    layer-only shape forever, for daemon builds before this one) -- see
    apps/api/src/routes/spatial.ts. `updatedAt` is used (not by
    `parser.build_payload`'s normalization math, which only reads the 4
    bound keys per layer) to detect a layer that's new or was just
    recalibrated since the last run -- see
    `ingestion.sync_spatial_calibrations`, which diffs against the
    previous run's cached dict and invalidates that map's already-synced
    replays so they get reparsed. Cached in `SyncState`'s `meta` table so
    a temporarily-unreachable API falls back to the last known
    calibrations instead of treating every map as uncalibrated. Returns
    None on any failure -- callers must treat that as "unknown", not
    "nothing is calibrated"."""
    try:
        response = requests.get(
            f"{base_url.rstrip('/')}/spatial/calibrations/by-layer",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=timeout,
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def fetch_summary(base_url: str, access_token: str, timeout: float = 5.0) -> dict | None:
    """Best-effort `GET {base_url}/ingest/summary` fetch, used to validate the
    Access Token field and to show the "games recorded" stat. Returns None on
    any failure (network error, timeout, invalid/expired token) — the caller
    only uses this for UI feedback, never for the daemon's actual config."""
    try:
        response = requests.get(
            f"{base_url.rstrip('/')}/ingest/summary",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=timeout,
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None
