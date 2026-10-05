"""The one path every daemon error takes to `POST /ingest/errors`.

Before this module, only 4 failure types inside `ingestion.ingest_file` were reported, each as
its own request. Now `ingest_file` *and* a `logging.Handler` (every WARNING/ERROR the daemon
logs) go through `ErrorReporter`, which keeps that from turning into a flood or a loop:

- repeats of the same report collapse into one with an `occurrences` count (a backlog of
  thousands of replays failing identically becomes a handful of requests);
- sends are rate-limited (`min_interval` seconds apart, `max_per_minute` per rolling minute);
- a report the API can't take (offline) is persisted in `SyncState`'s `pending_error_reports`
  (or kept in memory when there is no state db) and retried by a later `flush()`;
- nothing the reporter itself does logs above DEBUG, and records emitted *during* a flush on
  the flushing thread are ignored, so reporting can never report itself.

`report()` never blocks on the network: it only records. `flush()` does the sending and is
called by the upload scheduler between files (see `upload_scheduler.UploadScheduler`'s
`on_idle`) and once at the end of a headless `--resync`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections import deque
from typing import Callable, Protocol

from . import constants

logger = logging.getLogger(__name__)

_USER_DIR_RE = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\"']+", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\d+")
_MAX_PENDING_IN_MEMORY = 500
_MAX_MESSAGE_CHARS = 2000
_MAX_LOG_CHARS = 8000
# This module's package ("src"): the handler is attached there so it sees every daemon logger.
_PACKAGE_LOGGER = __name__.rpartition(".")[0]
# Loggers whose WARNING/ERROR records are *already* reported richly by ingest_file, or are
# retry noise (api_client logs every failed attempt). Matched on the last dotted segment.
_EXCLUDED_LOGGER_SUFFIXES = frozenset({"ingestion", "api_client", "error_reporter"})


class _State(Protocol):
    def enqueue_error_report(self, fingerprint: str, payload: str) -> None: ...
    def peek_error_reports(self, limit: int) -> list[tuple[int, str]]: ...
    def delete_error_reports(self, ids: list[int]) -> None: ...


def _truncate(text: str, limit: int) -> str:
    """Caps `text` at `limit` code points, then shrinks until it also fits `limit` UTF-16 code
    units: the server's zod `.max()` counts UTF-16 units, so non-BMP characters (emoji) count
    twice there and a code-point cut alone could still be rejected."""
    text = text[:limit]
    while len(text.encode("utf-16-le", "surrogatepass")) // 2 > limit:
        text = text[:-1]
    return text


def scrub_paths(text: str) -> str:
    """`C:\\Users\\<name>\\...` -> `~\\...`: tracebacks must not carry the player's Windows login."""
    return _USER_DIR_RE.sub("~", text)


def make_fingerprint(error_type: str, message: str, replay_hash: str | None) -> str:
    """Stable identity of a report. Digits are normalised so "failed after 3 tries" and
    "failed after 9 tries" collapse; the replay hash keeps per-replay failures distinct."""
    normalised = _NUMBER_RE.sub("#", scrub_paths(message))
    raw = f"{error_type}|{normalised}|{replay_hash or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:32]


class ErrorReporter:
    def __init__(
        self,
        send: Callable[[dict], bool],
        state: _State | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_per_minute: int = 30,
        min_interval: float = 1.0,
    ) -> None:
        self._send = send
        self._state = state
        self._clock = clock
        self._max_per_minute = max_per_minute
        self._min_interval = min_interval
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._local = threading.local()
        self._pending: dict[str, dict] = {}
        self._sent_at: deque[float] = deque()

    @property
    def is_flushing(self) -> bool:
        """True on the thread currently inside `flush()` (see `ReportingHandler`)."""
        return bool(getattr(self._local, "flushing", False))

    def report(
        self,
        error_type: str,
        message: str,
        *,
        replay_hash: str | None = None,
        base_build: int | None = None,
        error_log: str | None = None,
    ) -> None:
        message = _truncate(scrub_paths(message), _MAX_MESSAGE_CHARS) or "(no message)"
        log = _truncate(scrub_paths(error_log), _MAX_LOG_CHARS) if error_log else None
        fingerprint = make_fingerprint(error_type, message, replay_hash)
        with self._lock:
            existing = self._pending.get(fingerprint)
            if existing is not None:
                existing["occurrences"] += 1
                return
            if len(self._pending) >= _MAX_PENDING_IN_MEMORY:
                return
            self._pending[fingerprint] = {
                "replayHash": replay_hash,
                "baseBuild": base_build,
                "errorType": error_type,
                "errorMessage": message,
                "errorLog": log,
                "parserVersion": constants.PARSER_VERSION,
                "daemonVersion": constants.APP_VERSION,
                "heroprotocolVersion": constants.HEROPROTOCOL_VERSION,
                "fingerprint": fingerprint,
                "occurrences": 1,
            }

    def flush(self) -> int:
        """Sends what the rate limit allows, offline-queued reports first. Returns how many
        were delivered. Stops at the first failed send (the API is probably unreachable)."""
        if not self._flush_lock.acquire(blocking=False):
            return 0
        self._local.flushing = True
        try:
            sent = 0
            while self._may_send():
                queued = self._state.peek_error_reports(1) if self._state is not None else []
                if queued:
                    row_id, payload = queued[0]
                    try:
                        queued_report = json.loads(payload)
                    except ValueError:
                        # A corrupt row would otherwise block the queue forever.
                        self._state.delete_error_reports([row_id])
                        continue
                    if not self._safe_send(queued_report):
                        break
                    self._state.delete_error_reports([row_id])
                else:
                    with self._lock:
                        if not self._pending:
                            break
                        fingerprint, report = next(iter(self._pending.items()))
                        del self._pending[fingerprint]
                    if not self._safe_send(report):
                        self._requeue(fingerprint, report)
                        break
                self._sent_at.append(self._clock())
                sent += 1
            return sent
        finally:
            self._local.flushing = False
            self._flush_lock.release()

    def _safe_send(self, report: dict) -> bool:
        """`send` raising is treated like a failed send: flush() must never raise."""
        try:
            return bool(self._send(report))
        except Exception:  # noqa: BLE001
            logger.debug("error report send raised", exc_info=True)
            return False

    def persist_pending(self) -> int:
        """Moves every in-memory pending report into the offline queue. A flush delivers at
        most one report per `min_interval`, so a short-lived process (headless --resync,
        daemon stop) calls this at the end so the rest survive for the next run."""
        if self._state is None:
            return 0
        with self._lock:
            items = list(self._pending.items())
            self._pending.clear()
        for fingerprint, report in items:
            self._state.enqueue_error_report(fingerprint, json.dumps(report))
        return len(items)

    def _may_send(self) -> bool:
        now = self._clock()
        while self._sent_at and now - self._sent_at[0] >= 60.0:
            self._sent_at.popleft()
        if len(self._sent_at) >= self._max_per_minute:
            return False
        return not self._sent_at or now - self._sent_at[-1] >= self._min_interval

    def _requeue(self, fingerprint: str, report: dict) -> None:
        if self._state is not None:
            self._state.enqueue_error_report(fingerprint, json.dumps(report))
            return
        with self._lock:
            self._pending.setdefault(fingerprint, report)


class ReportingHandler(logging.Handler):
    """Forwards WARNING+ records to an `ErrorReporter` as `runtime` errors."""

    def __init__(self, reporter: ErrorReporter) -> None:
        super().__init__(level=logging.WARNING)
        self._reporter = reporter

    def emit(self, record: logging.LogRecord) -> None:
        if self._reporter.is_flushing:
            return
        if record.name.rpartition(".")[2] in _EXCLUDED_LOGGER_SUFFIXES:
            return
        try:
            log = None
            if record.exc_info:
                log = "".join(logging.Formatter().formatException(record.exc_info))
            self._reporter.report(
                "runtime", f"{record.name.rpartition('.')[2]}: {record.getMessage()}", error_log=log
            )
        except Exception:  # noqa: BLE001 -- a logging handler must never raise
            self.handleError(record)


def install_logging_handler(reporter: ErrorReporter, logger_name: str | None = None) -> ReportingHandler:
    handler = ReportingHandler(reporter)
    logging.getLogger(_PACKAGE_LOGGER if logger_name is None else logger_name).addHandler(handler)
    return handler


def uninstall_logging_handler(handler: ReportingHandler, logger_name: str | None = None) -> None:
    logging.getLogger(_PACKAGE_LOGGER if logger_name is None else logger_name).removeHandler(handler)
