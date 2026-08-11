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
