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
