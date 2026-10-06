"""Pure helpers for the Synchronisation tab's recap panel (no tkinter)."""

from __future__ import annotations

from dataclasses import dataclass


def recap_columns(width: int) -> int:
    """How many stat tiles fit side by side in `width` pixels."""
    if width >= 640:
        return 3
    if width >= 380:
        return 2
    return 1


@dataclass(frozen=True)
class Progress:
    percent: int
    label: str
    state: str  # "idle" | "running" | "done"


def progress_summary(found: int, synced: int, failed: int, up_to_date: int = 0) -> Progress:
    if found <= 0:
        return Progress(0, "Aucune partie trouvée", "idle")
    done = synced + failed + up_to_date
    percent = min(100, round(done / found * 100))
    if done >= found:
        label = "Tout est à jour" if failed == 0 else f"Terminé — {failed} échec(s)"
        return Progress(100, label, "done")
    return Progress(percent, f"{done} / {found} parties", "running")
