"""Persists the settings window's size/position across sessions, so it
doesn't reopen at whatever the (now dynamic, see `ui_kit.ScrollableFrame`)
natural size happens to compute to every time. Mirrors `config.py`'s
`%APPDATA%/hots-analytics/` resolution.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WindowGeometry:
    width: int
    height: int
    x: int
    y: int
    maximized: bool = False


def window_state_path() -> Path:
    """Path to the JSON window-state file, next to the daemon's config
    file (e.g. `%APPDATA%\\hots-analytics\\window.json`)."""
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home() / ".config"
    return base / "hots-analytics" / "window.json"


def load_window_geometry(path: Path | None = None) -> WindowGeometry | None:
    """Returns the last saved geometry, or `None` if there is none yet or
    the file can't be parsed. Best-effort: a missing/corrupt file falls
    back to the caller's default centered size rather than raising."""
    target = path or window_state_path()
    if not target.is_file():
        return None
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        return WindowGeometry(
            width=int(raw["width"]),
            height=int(raw["height"]),
            x=int(raw["x"]),
            y=int(raw["y"]),
            maximized=bool(raw.get("maximized", False)),
        )
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as err:
        logger.debug("Failed to read window state at %s: %s", target, err)
        return None


def save_window_geometry(geometry: WindowGeometry, path: Path | None = None) -> None:
    """Writes `geometry` to disk, creating the parent directory if needed.
    Best-effort: a write failure (e.g. a locked file) is logged, not
    raised — losing the remembered window position is not worth crashing
    the settings window over."""
    target = path or window_state_path()
    payload = {
        "width": geometry.width,
        "height": geometry.height,
        "x": geometry.x,
        "y": geometry.y,
        "maximized": geometry.maximized,
    }
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as err:
        logger.debug("Failed to save window state at %s: %s", target, err)


def clamp_to_screen(
    geometry: WindowGeometry,
    screen_width: int,
    screen_height: int,
    *,
    min_width: int,
    min_height: int,
) -> WindowGeometry | None:
    """Keeps a saved geometry fully on the current screen, or discards it
    (`None`) if it can no longer fit at all — an undocked laptop or a
    changed monitor layout, where the caller should fall back to its
    default centered size instead of showing a too-small or partially
    off-screen window."""
    if geometry.width < min_width or geometry.height < min_height:
        return None
    if geometry.width > screen_width or geometry.height > screen_height:
        return None
    max_x = max(0, screen_width - geometry.width)
    max_y = max(0, screen_height - geometry.height)
    return WindowGeometry(
        width=geometry.width,
        height=geometry.height,
        x=min(max(geometry.x, 0), max_x),
        y=min(max(geometry.y, 0), max_y),
        maximized=geometry.maximized,
    )
