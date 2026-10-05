"""Is this daemon's `heroprotocol` older than what the API now requires?

`heroprotocol` is the one thing a *new replay build* can force a daemon update for (a build whose
protocol file the bundled version doesn't have). A build the existing decoder handles fine needs
no update at all -- the API just marks it compatible (`bun run check-build`). So the API only
announces `minHeroprotocolVersion` when an update is genuinely needed, and until the daemon
catches up the scheduler holds the backlog back instead of failing thousands of files.
"""

from __future__ import annotations

import threading

from . import constants


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) if part.isdigit() else 0 for part in version.split("."))


class DependencyGuard:
    def __init__(self, current: str = constants.HEROPROTOCOL_VERSION) -> None:
        self._current = current
        self._required: str | None = None
        self._lock = threading.Lock()

    @property
    def required(self) -> str | None:
        return self._required

    @property
    def blocked(self) -> bool:
        required = self._required
        return required is not None and _version_tuple(self._current) < _version_tuple(required)

    def update(self, minimum: str | None) -> bool:
        """Records the API's current requirement. True only when this call *turns the guard on*,
        so the caller reports / notifies once rather than on every periodic check."""
        with self._lock:
            was_blocked = self.blocked
            self._required = minimum or None
            return self.blocked and not was_blocked
