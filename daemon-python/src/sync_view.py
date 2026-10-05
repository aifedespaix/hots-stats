"""Turns `SyncState` rows plus the upload scheduler's live queue into the rows the Sync tab's
table shows. Pure (no tkinter, no I/O) so it is unit-tested directly.

The 8 display states are *derived*, never stored, because `replays.status` has a CHECK
constraint limiting it to 'synced'/'error' (see sync_state._ensure_skip_reason_column).
`pending` / `uploading` have no row at all -- a row is keyed by content hash, unknown until
the scheduler reads the file -- so they arrive via `live` (file path -> state).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import PureWindowsPath

from .sync_state import ReplayRow, _version_gte

STATES = ("pending", "uploading", "synced", "outdated", "error", "quarantined", "skipped", "missing")
STATE_LABELS = {
    "pending": "En attente",
    "uploading": "Envoi…",
    "synced": "À jour",
    "outdated": "À renvoyer",
    "error": "Erreur",
    "quarantined": "Build non géré",
    "skipped": "Ignorée",
    "missing": "Fichier absent",
}
_DASH = "—"


@dataclass(frozen=True)
class SyncRowView:
    key: str  # replay hash, or "path:<path>" for a file with no row yet
    state: str
    label: str
    played: str  # display strings
    uploaded: str
    result: str
    build: str
    file_path: str
    file_exists: bool
    detail: str | None  # error / skip message, shown on hover
    sort_at: str  # ISO string used for the default most-recent-first order
    played_raw: str
    uploaded_raw: str


def derive_state(row: ReplayRow, min_parser_version: str | None) -> str:
    if row.status == "error":
        if not row.file_exists:
            return "missing"
        return "quarantined" if row.error_kind == "quarantine" else "error"
    if row.skip_reason:
        return "skipped"
    if min_parser_version and row.parser_version and not _version_gte(row.parser_version, min_parser_version):
        return "outdated"
    return "synced"


def _pretty(value: str) -> str:
    text = value.replace("-", " ").replace("_", " ")
    return text.title() if text == text.lower() else text


def format_when(iso: str | None) -> str:
    """ISO timestamp -> `dd/mm/yyyy hh:mm` in local time; a dash when absent or unparseable."""
    if not iso:
        return _DASH
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return _DASH
    if moment.tzinfo is not None:
        moment = moment.astimezone()
    return moment.strftime("%d/%m/%Y %H:%M")


def _label(row: ReplayRow) -> str:
    parts = [
        _pretty(row.map_slug) if row.map_slug else None,
        _pretty(row.hero) if row.hero else None,
        row.game_mode or None,
    ]
    shown = [p for p in parts if p]
    return " · ".join(shown) if shown else PureWindowsPath(row.file_path).stem or row.replay_hash[:8]


def _result(won: bool | None) -> str:
    return _DASH if won is None else ("Victoire" if won else "Défaite")


def build_views(
    rows: list[ReplayRow], live: dict[str, str], min_parser_version: str | None
) -> list[SyncRowView]:
    views: list[SyncRowView] = []
    seen: set[str] = set()
    for row in rows:
        seen.add(row.file_path)
        views.append(
            SyncRowView(
                key=row.replay_hash,
                state=live.get(row.file_path) or derive_state(row, min_parser_version),
                label=_label(row),
                played=format_when(row.played_at),
                uploaded=format_when(row.synced_at),
                result=_result(row.won),
                build=str(row.base_build) if row.base_build else _DASH,
                file_path=row.file_path,
                file_exists=row.file_exists,
                detail=row.error_message,
                sort_at=row.played_at or row.synced_at or row.last_attempt_at,
                played_raw=row.played_at or "",
                uploaded_raw=row.synced_at or "",
            )
        )
    for path, state in live.items():
        if path in seen:
            continue
        views.append(
            SyncRowView(
                key=f"path:{path}", state=state, label=PureWindowsPath(path).stem, played=_DASH, uploaded=_DASH,
                result=_DASH, build=_DASH, file_path=path, file_exists=True, detail=None,
                sort_at="", played_raw="", uploaded_raw="",
            )
        )
    return sorted(views, key=lambda v: v.sort_at, reverse=True)


def count_by_state(views: list[SyncRowView]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for view in views:
        counts[view.state] = counts.get(view.state, 0) + 1
    return counts


def filter_views(views: list[SyncRowView], state: str | None) -> list[SyncRowView]:
    return list(views) if state is None else [v for v in views if v.state == state]


_SORT_KEYS = {
    "label": lambda v: v.label.lower(),
    "played": lambda v: v.played_raw,
    "uploaded": lambda v: v.uploaded_raw,
    "result": lambda v: v.result,
    "state": lambda v: v.state,
    # Numeric, not lexicographic ("9999" < "96477"); the "—" placeholder sorts lowest.
    "build": lambda v: int(v.build) if v.build.isdigit() else -1,
}


def sort_views(views: list[SyncRowView], column: str, *, descending: bool) -> list[SyncRowView]:
    return sorted(views, key=_SORT_KEYS[column], reverse=descending)
