"""Fills the Sync tab's display columns (map, hero, mode, date, result) for replays the daemon
synced before it recorded them locally -- from what the *server already stores*, in batches,
without parsing a single replay (re-parsing thousands of files is exactly the CPU cost the
upload scheduler exists to avoid).

Also closes the loop for builds the API didn't recognise: a replay the daemon marked
`quarantined` becomes `synced` as soon as a lookup finds it server-side (i.e. someone ran
`bun run check-build`), with no daemon update and no re-upload.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from .api_client import ApiClient
from .sync_state import ReplayRow, SyncState

logger = logging.getLogger(__name__)


def _chunks(rows: list[ReplayRow], size: int):
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


class HistoryEnricher:
    def __init__(
        self,
        client: ApiClient,
        sync_state: SyncState,
        *,
        batch_size: int = 200,
        pause_seconds: float = 0.5,
        wait: Callable[[float], object] | None = None,
        stop_event: threading.Event | None = None,
    ) -> None:
        self._client = client
        self._state = sync_state
        self._batch = batch_size
        self._pause = pause_seconds
        # With a stop event the pause doubles as the shutdown signal, so `_DaemonRunner.stop()`
        # isn't left waiting on a pass that is mid-sleep or mid-way through thousands of rows.
        self._stop = stop_event
        self._wait = wait or (stop_event.wait if stop_event is not None else time.sleep)

    def _stopping(self) -> bool:
        return self._stop is not None and self._stop.is_set()

    def run_once(self) -> int:
        """One pass over everything that needs filling. Each row is asked about at most once
        per pass (a match deleted server-side must not be re-queried forever). Returns how
        many rows were updated; stops quietly if the API can't be reached."""
        updated = 0
        for chunk in _chunks(self._state.rows_needing_enrichment(), self._batch):
            found = self._client.lookup_matches(match_ids=[row.match_id for row in chunk if row.match_id])
            if found is None:
                return updated
            by_id = {item["matchId"]: item for item in found}
            for row in chunk:
                info = by_id.get(row.match_id or "")
                if info is None:
                    continue
                self._state.apply_match_info(
                    row.match_id,
                    map_slug=info.get("map"),
                    game_mode=info.get("gameMode"),
                    played_at=info.get("playedAt"),
                    hero=info.get("hero"),
                    won=info.get("won"),
                )
                updated += 1
            self._wait(self._pause)
            if self._stopping():
                return updated

        if self._stopping():
            return updated
        for chunk in _chunks(self._state.rows_quarantined(), self._batch):
            found = self._client.lookup_matches(replay_hashes=[row.replay_hash for row in chunk])
            if found is None:
                return updated
            by_hash = {item["replayHash"]: item for item in found}
            for row in chunk:
                info = by_hash.get(row.replay_hash)
                if info is None:
                    continue
                self._state.reconcile_quarantined(
                    row.replay_hash,
                    info["matchId"],
                    info["parserVersion"],
                    map_slug=info.get("map"),
                    game_mode=info.get("gameMode"),
                    played_at=info.get("playedAt"),
                    hero=info.get("hero"),
                    won=info.get("won"),
                )
                updated += 1
            self._wait(self._pause)
            if self._stopping():
                return updated
        return updated
