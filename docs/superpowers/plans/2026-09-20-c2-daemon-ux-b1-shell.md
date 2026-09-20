# Daemon UX Redesign — C2 Checkpoint B1 (design tokens + DPI + resizable/scrollable shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon's settings window (`daemon-python/src/gui.py`) DPI-aware, resizable, and
scrollable, replacing the fixed worst-case-measured size and hand-tuned text-truncation constants —
with **no behavior change** beyond layout (same tabs, same fields, same actions).

**Architecture:** Two new stdlib-only modules carry the testable logic: `src/ui_kit.py` (DPI scale
factor, DPI-scaled `Fonts`, a `ScrollableFrame` container, best-effort `set_dpi_awareness()`) and
`src/window_state.py` (a pure `WindowGeometry` dataclass, JSON persistence to
`%APPDATA%/hots-analytics/window.json`, and a pure `clamp_to_screen` function). `gui.py` is modified
to consume both: every tab body is wrapped in a `ScrollableFrame`, the window becomes resizable with
a real `minsize`, and geometry is restored/persisted across sessions instead of being locked to a
computed worst-case size.

**Tech Stack:** Python 3.11+, stdlib `tkinter`/`ttk`, `pytest`. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-18-daemon-ux-redesign-design.md` (Decision 3, "Components
→ Widget kit" tokens subset, "Files touched"), scoped to the **B1** checkpoint in
`docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md` ("design tokens + DPI +
resizable/scrollable shell — layout change only, same functionality"). B2 (full widget kit: `Card`,
`Button` variants, `StatusPill`, health banner, etc.) and B3/B4 are **out of scope** for this plan.

## Global Constraints

- No i18n: all UI copy stays French (spec-wide constraint; this plan doesn't add user-facing copy).
- No new runtime dependency (Decision 1 of the spec: stay on stdlib tkinter).
- No change to the OCR/crop pipeline, the parser, the sync engine, or the update mechanism
  (spec Non-goals).
- No change to ingestion or auth behavior (spec Non-goals).
- CI (`daemon-tests` job in `.github/workflows/ci.yml`) runs `pytest -q` on `ubuntu-latest` with
  **no display server** — any new test that instantiates a real `tk.Tk()`/`tk.Canvas`/`ttk.Frame`
  will hang or fail in CI. Every automated test in this plan uses plain dataclasses, stub objects,
  or file I/O only — never a real Tk widget. Widget construction and on-screen layout are verified
  by hand (spec's own Testing section: "this repo has no `gui.py` tests and CI is headless").
- Branch protocol (`docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md`): work
  happens on `feat/daemon-ux-redesign`, branched from an up-to-date `main`. Pushing the branch is
  free (no release). **Never merge to `main` from this plan** — merging is a separate, explicit
  decision gated on the full C2 chantier (or at minimum this checkpoint) being manually verified.

---

## Setup

- [ ] **Step 1:** Sync `main` and create the chantier branch.

```bash
git fetch origin
git checkout main
git pull
git checkout -b feat/daemon-ux-redesign
```

- [ ] **Step 2:** Confirm the daemon test suite is green before making any change (baseline).

Run: `cd daemon-python && pytest -q`
Expected: all existing tests pass (no failures, no errors).

---

### Task 1: `ui_kit.py` — DPI scale factor and DPI-scaled fonts

**Files:**
- Create: `daemon-python/src/ui_kit.py`
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.dpi_scale_factor(root) -> float`, `ui_kit.FONT_FAMILY: str`,
  `ui_kit.Fonts` (frozen dataclass with fields `body: tuple`, `muted: tuple`, `section: tuple`,
  `title: tuple`, `link: tuple`, `button: tuple`, `button_bold: tuple`, each a ttk-compatible font
  tuple `(family, size)` or `(family, size, style)`), `ui_kit.Fonts.for_scale(scale: float) -> Fonts`
  (classmethod), `ui_kit.DEFAULT_FONTS: Fonts` (module-level `Fonts.for_scale(1.0)`).
  Later tasks (Task 8) call `Fonts.for_scale(dpi_scale_factor(root))`.

- [ ] **Step 1: Write failing tests for `Fonts.for_scale`**

```python
# daemon-python/tests/test_ui_kit.py
from src import ui_kit


def test_fonts_for_scale_1_0_matches_todays_hardcoded_sizes():
    fonts = ui_kit.Fonts.for_scale(1.0)
    assert fonts.body == ("Segoe UI", 10)
    assert fonts.muted == ("Segoe UI", 9)
    assert fonts.section == ("Segoe UI", 9, "bold")
    assert fonts.title == ("Segoe UI", 15, "bold")
    assert fonts.link == ("Segoe UI", 9, "underline")
    assert fonts.button == ("Segoe UI", 10)
    assert fonts.button_bold == ("Segoe UI", 10, "bold")


def test_fonts_for_scale_scales_every_size_and_rounds():
    fonts = ui_kit.Fonts.for_scale(1.5)
    assert fonts.body == ("Segoe UI", 15)
    assert fonts.title == ("Segoe UI", 23, "bold")  # 15 * 1.5 = 22.5 -> round -> 23


def test_fonts_for_scale_never_produces_a_zero_or_negative_size():
    fonts = ui_kit.Fonts.for_scale(0.01)
    assert fonts.muted[1] >= 1


def test_default_fonts_is_scale_1_0():
    assert ui_kit.DEFAULT_FONTS == ui_kit.Fonts.for_scale(1.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.ui_kit'` (or `ImportError`).

- [ ] **Step 3: Write `ui_kit.py` with `Fonts`**

```python
# daemon-python/src/ui_kit.py
"""Design tokens and stdlib-tkinter primitives shared by the settings window
(`gui.py`). Kept dependency-free and, where possible, free of any real Tk
widget so its scaling/geometry logic can be unit-tested headless (CI has no
display server — see `daemon-python/tests/test_ui_kit.py`).
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)

FONT_FAMILY = "Segoe UI"


@dataclass(frozen=True)
class Fonts:
    """Named, DPI-scaled fonts for the settings window. Base sizes (at
    scale 1.0, i.e. 96 DPI) match the hardcoded values `gui.py` used before
    this module existed, so switching a style over to one of these is a
    no-visual-change-at-96-DPI refactor."""

    body: tuple
    muted: tuple
    section: tuple
    title: tuple
    link: tuple
    button: tuple
    button_bold: tuple

    @classmethod
    def for_scale(cls, scale: float) -> "Fonts":
        def sized(base_size: int, *style: str) -> tuple:
            size = max(1, round(base_size * scale))
            return (FONT_FAMILY, size, *style) if style else (FONT_FAMILY, size)

        return cls(
            body=sized(10),
            muted=sized(9),
            section=sized(9, "bold"),
            title=sized(15, "bold"),
            link=sized(9, "underline"),
            button=sized(10),
            button_bold=sized(10, "bold"),
        )


DEFAULT_FONTS = Fonts.for_scale(1.0)


class _WinfoFpixels(Protocol):
    def winfo_fpixels(self, distance: str) -> float: ...


def dpi_scale_factor(root: _WinfoFpixels) -> float:
    """Ratio of the display's actual DPI to the tkinter/Tcl baseline of 96.
    `root` is anything exposing `winfo_fpixels` (a real `tk.Tk`/`tk.Misc` in
    production; a stub in tests) so this stays headless-testable."""
    return root.winfo_fpixels("1i") / 96.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Add and run a headless test for `dpi_scale_factor` using a stub (no real Tk)**

```python
# daemon-python/tests/test_ui_kit.py (append)
class _FakeWinfo:
    def __init__(self, fpixels_per_inch: float) -> None:
        self._fpixels_per_inch = fpixels_per_inch

    def winfo_fpixels(self, distance: str) -> float:
        assert distance == "1i"
        return self._fpixels_per_inch


def test_dpi_scale_factor_at_96_dpi_is_1_0():
    assert ui_kit.dpi_scale_factor(_FakeWinfo(96.0)) == 1.0


def test_dpi_scale_factor_at_150_percent_scaling():
    assert ui_kit.dpi_scale_factor(_FakeWinfo(144.0)) == 1.5
```

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "feat(daemon): add DPI-scaled Fonts and dpi_scale_factor to ui_kit"
```

---

### Task 2: `ui_kit.py` — best-effort `set_dpi_awareness()`

**Files:**
- Modify: `daemon-python/src/ui_kit.py`
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.set_dpi_awareness() -> None`. Consumed by Task 7 (`main.py`).

- [ ] **Step 1: Write failing tests**

```python
# daemon-python/tests/test_ui_kit.py (append)
import types
from unittest.mock import patch


def test_set_dpi_awareness_is_a_noop_off_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    ui_kit.set_dpi_awareness()  # must not raise even though ctypes.windll doesn't exist on Linux


def test_set_dpi_awareness_calls_per_monitor_v2_on_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    fake_shcore = types.SimpleNamespace(SetProcessDpiAwareness=lambda value: setattr(
        fake_shcore, "called_with", value
    ))
    fake_windll = types.SimpleNamespace(shcore=fake_shcore, user32=types.SimpleNamespace())
    with patch("ctypes.windll", fake_windll, create=True):
        ui_kit.set_dpi_awareness()
    assert fake_shcore.called_with == 2  # PROCESS_PER_MONITOR_DPI_AWARE


def test_set_dpi_awareness_falls_back_to_set_process_dpi_aware(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")

    def _raise(_value):
        raise AttributeError("no shcore on this Windows version")

    calls = []
    fake_windll = types.SimpleNamespace(
        shcore=types.SimpleNamespace(SetProcessDpiAwareness=_raise),
        user32=types.SimpleNamespace(SetProcessDPIAware=lambda: calls.append(True)),
    )
    with patch("ctypes.windll", fake_windll, create=True):
        ui_kit.set_dpi_awareness()
    assert calls == [True]


def test_set_dpi_awareness_never_raises_even_if_both_calls_fail(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")

    def _raise_shcore(_value):
        raise OSError("access denied")

    def _raise_user32():
        raise OSError("access denied")

    fake_windll = types.SimpleNamespace(
        shcore=types.SimpleNamespace(SetProcessDpiAwareness=_raise_shcore),
        user32=types.SimpleNamespace(SetProcessDPIAware=_raise_user32),
    )
    with patch("ctypes.windll", fake_windll, create=True):
        ui_kit.set_dpi_awareness()  # must not raise
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v -k set_dpi_awareness`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'set_dpi_awareness'`.

- [ ] **Step 3: Implement `set_dpi_awareness`**

```python
# daemon-python/src/ui_kit.py (append)

# PROCESS_PER_MONITOR_DPI_AWARE, from Windows' shcore.h — not imported from
# anywhere since this repo has no Windows-specific typing stubs; the literal
# is documented stable API surface (Per-Monitor-V2 DPI awareness).
_PROCESS_PER_MONITOR_DPI_AWARE = 2


def set_dpi_awareness() -> None:
    """Opts the process into Per-Monitor-V2 DPI awareness, with a fallback
    to the older system-DPI-only API, so the settings window isn't
    bitmap-scaled (blurry) on a 125%/150% display. Must be called before
    any `tk.Tk()` is created (Windows ignores the call afterwards) — see
    `main.py`. Best-effort and never fatal: an unsupported/older Windows,
    or a process that already had awareness set by something else, is not
    an error worth stopping the daemon over."""
    if sys.platform != "win32":
        return
    import ctypes

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(_PROCESS_PER_MONITOR_DPI_AWARE)
        return
    except (AttributeError, OSError) as err:
        logger.debug("SetProcessDpiAwareness unavailable, falling back: %s", err)

    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except (AttributeError, OSError) as err:
        logger.debug("SetProcessDPIAware also failed: %s", err)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "feat(daemon): add best-effort Per-Monitor-V2 DPI awareness"
```

---

### Task 3: `ui_kit.py` — `Palette` (wraps today's colors, no new colors yet)

**Files:**
- Modify: `daemon-python/src/ui_kit.py`
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.Palette` (frozen dataclass: `bg`, `panel`, `field_bg`, `field_bg_focus`, `text`,
  `text_muted`, `accent`, `ok`, `error`, `neutral`, all `str` hex colors), `ui_kit.DEFAULT_PALETTE`.
  Consumed by Task 8 (`gui.py`'s `_apply_dark_style`). `_WARN` and a higher-contrast muted color are
  explicitly **deferred to B2** (spec's Widget kit section, not Decision 3) — do not add them here.

- [ ] **Step 1: Write failing test**

```python
# daemon-python/tests/test_ui_kit.py (append)
def test_default_palette_matches_todays_hardcoded_colors():
    assert ui_kit.DEFAULT_PALETTE == ui_kit.Palette(
        bg="#1c1f2e",
        panel="#252a3d",
        field_bg="#2f3550",
        field_bg_focus="#394069",
        text="#e8eaf6",
        text_muted="#8b90ad",
        accent="#6c8cff",
        ok="#4cd97b",
        error="#ef5b5b",
        neutral="#8b90ad",
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v -k default_palette`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'Palette'`.

- [ ] **Step 3: Implement `Palette`**

```python
# daemon-python/src/ui_kit.py (append)
@dataclass(frozen=True)
class Palette:
    """A small, dark, "gamer tool" color set. Values match `gui.py`'s
    previous module-level color constants exactly (this is a no-visual-
    change extraction); B2 (widget kit) is where `warn` and a higher-
    contrast muted color get added, per the spec's Decision on scope."""

    bg: str
    panel: str
    field_bg: str
    field_bg_focus: str
    text: str
    text_muted: str
    accent: str
    ok: str
    error: str
    neutral: str


DEFAULT_PALETTE = Palette(
    bg="#1c1f2e",
    panel="#252a3d",
    field_bg="#2f3550",
    field_bg_focus="#394069",
    text="#e8eaf6",
    text_muted="#8b90ad",
    accent="#6c8cff",
    ok="#4cd97b",
    error="#ef5b5b",
    neutral="#8b90ad",
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "feat(daemon): add ui_kit.Palette wrapping today's settings-window colors"
```

---

### Task 4: `ui_kit.py` — `ScrollableFrame` + testable mouse-wheel math

**Files:**
- Modify: `daemon-python/src/ui_kit.py`
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.mousewheel_scroll_units(delta: int) -> int` (pure, tested),
  `ui_kit.ScrollableFrame` (a real Tk container class — **not unit-tested**, per Global Constraints;
  exercised by hand once wired into `gui.py` in Task 10). `ScrollableFrame(parent, *, background:
  str) -> ScrollableFrame` exposes `.outer` (a `tk.Frame`, the widget callers `pack`/`grid` into the
  tab) and `.content` (a `ttk.Frame`, the widget callers build the tab's real content into).

- [ ] **Step 1: Write failing test for the pure mouse-wheel helper**

```python
# daemon-python/tests/test_ui_kit.py (append)
def test_mousewheel_scroll_units_scroll_up():
    assert ui_kit.mousewheel_scroll_units(120) == -1


def test_mousewheel_scroll_units_scroll_down():
    assert ui_kit.mousewheel_scroll_units(-120) == 1


def test_mousewheel_scroll_units_fast_scroll_scales_linearly():
    assert ui_kit.mousewheel_scroll_units(240) == -2
    assert ui_kit.mousewheel_scroll_units(-360) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v -k mousewheel`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'mousewheel_scroll_units'`.

- [ ] **Step 3: Implement the helper and `ScrollableFrame`**

```python
# daemon-python/src/ui_kit.py — add to the top-level imports:
import tkinter as tk
from tkinter import ttk

# daemon-python/src/ui_kit.py (append)


def mousewheel_scroll_units(delta: int) -> int:
    """Converts a Windows `<MouseWheel>` event's `delta` (a signed multiple
    of 120: positive = wheel up, negative = wheel down) into the number of
    `Canvas.yview_scroll` "units" to move, per the standard Tk recipe.
    Pure so it's testable without a real event/widget."""
    return int(-delta / 120)


class ScrollableFrame:
    """A vertically scrollable container: a `tk.Canvas` holding one inner
    `ttk.Frame` (`.content`), with a `ttk.Scrollbar` and mouse-wheel
    support. Every settings-window tab body lives in one of these (see
    `gui.py`'s `_build_tab`) instead of being sized to its worst-case
    content up front.

    Not unit-tested: constructing it requires a real Tk interpreter, which
    CI's headless runner doesn't have (see `mousewheel_scroll_units` above
    for the one piece of its logic that *is* pure). Verified by hand at
    multiple DPI scales and window sizes.
    """

    def __init__(self, parent: tk.Misc, *, background: str) -> None:
        self.outer = tk.Frame(parent, bg=background)
        self._canvas = tk.Canvas(
            self.outer, background=background, highlightthickness=0, borderwidth=0
        )
        scrollbar = ttk.Scrollbar(
            self.outer, orient="vertical", command=self._canvas.yview
        )
        self._canvas.configure(yscrollcommand=scrollbar.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.content = ttk.Frame(self._canvas, style="TFrame")
        self._content_window = self._canvas.create_window(
            (0, 0), window=self.content, anchor="nw"
        )

        self.content.bind("<Configure>", self._on_content_configure)
        self._canvas.bind("<Configure>", self._on_canvas_configure)
        self._canvas.bind("<Enter>", self._bind_mousewheel)
        self._canvas.bind("<Leave>", self._unbind_mousewheel)

    def _on_content_configure(self, _event: "tk.Event") -> None:
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))

    def _on_canvas_configure(self, event: "tk.Event") -> None:
        # Keeps the inner frame exactly as wide as the visible canvas, so
        # content wraps/reflows on window resize instead of leaving a gap
        # or requiring horizontal scrolling.
        self._canvas.itemconfigure(self._content_window, width=event.width)

    def _bind_mousewheel(self, _event: "tk.Event") -> None:
        self._canvas.bind_all("<MouseWheel>", self._on_mousewheel)

    def _unbind_mousewheel(self, _event: "tk.Event") -> None:
        self._canvas.unbind_all("<MouseWheel>")

    def _on_mousewheel(self, event: "tk.Event") -> None:
        self._canvas.yview_scroll(mousewheel_scroll_units(event.delta), "units")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "feat(daemon): add ScrollableFrame widget and its mouse-wheel math"
```

---

### Task 5: `window_state.py` — `WindowGeometry` + JSON persistence

**Files:**
- Create: `daemon-python/src/window_state.py`
- Test: `daemon-python/tests/test_window_state.py`

**Interfaces:**
- Produces: `window_state.WindowGeometry` (frozen dataclass: `width: int`, `height: int`, `x: int`,
  `y: int`, `maximized: bool = False`), `window_state.window_state_path() -> Path`,
  `window_state.load_window_geometry(path: Path | None = None) -> WindowGeometry | None`,
  `window_state.save_window_geometry(geometry: WindowGeometry, path: Path | None = None) -> None`.
  Consumed by Task 9 (`gui.py`).

- [ ] **Step 1: Write failing tests**

```python
# daemon-python/tests/test_window_state.py
import json

from src import window_state


def test_window_state_path_defaults_to_appdata(monkeypatch, tmp_path):
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    assert window_state.window_state_path() == (
        tmp_path / "AppData" / "hots-analytics" / "window.json"
    )


def test_load_window_geometry_returns_none_when_file_is_missing(tmp_path):
    assert window_state.load_window_geometry(tmp_path / "window.json") is None


def test_save_then_load_round_trips(tmp_path):
    path = tmp_path / "hots-analytics" / "window.json"
    geometry = window_state.WindowGeometry(width=1024, height=768, x=100, y=50, maximized=False)

    window_state.save_window_geometry(geometry, path)
    loaded = window_state.load_window_geometry(path)

    assert loaded == geometry


def test_save_creates_parent_directory(tmp_path):
    path = tmp_path / "does" / "not" / "exist" / "window.json"
    window_state.save_window_geometry(
        window_state.WindowGeometry(width=800, height=600, x=0, y=0), path
    )
    assert path.is_file()


def test_load_window_geometry_returns_none_on_corrupt_json(tmp_path):
    path = tmp_path / "window.json"
    path.write_text("not json", encoding="utf-8")
    assert window_state.load_window_geometry(path) is None


def test_load_window_geometry_returns_none_when_a_required_field_is_missing(tmp_path):
    path = tmp_path / "window.json"
    path.write_text(json.dumps({"width": 800}), encoding="utf-8")
    assert window_state.load_window_geometry(path) is None


def test_load_window_geometry_defaults_maximized_to_false_when_absent(tmp_path):
    path = tmp_path / "window.json"
    path.write_text(
        json.dumps({"width": 800, "height": 600, "x": 0, "y": 0}), encoding="utf-8"
    )
    assert window_state.load_window_geometry(path).maximized is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_window_state.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.window_state'`.

- [ ] **Step 3: Implement `window_state.py`**

```python
# daemon-python/src/window_state.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_window_state.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/window_state.py daemon-python/tests/test_window_state.py
git commit -m "feat(daemon): add WindowGeometry JSON persistence"
```

---

### Task 6: `window_state.py` — pure `clamp_to_screen`

**Files:**
- Modify: `daemon-python/src/window_state.py`
- Test: `daemon-python/tests/test_window_state.py`

**Interfaces:**
- Produces: `window_state.clamp_to_screen(geometry: WindowGeometry, screen_width: int,
  screen_height: int, *, min_width: int, min_height: int) -> WindowGeometry | None`. Consumed by
  Task 9 (`gui.py`).

- [ ] **Step 1: Write failing tests**

```python
# daemon-python/tests/test_window_state.py (append)
def test_clamp_to_screen_leaves_a_fully_visible_geometry_unchanged():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=100, y=100)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result == geometry


def test_clamp_to_screen_pulls_a_partially_off_left_window_back_on_screen():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=-200, y=50)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.x == 0
    assert (result.width, result.height, result.y) == (1000, 700, 50)


def test_clamp_to_screen_pulls_a_window_off_the_right_edge_back_on_screen():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=1800, y=50)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.x == 920  # 1920 - 1000


def test_clamp_to_screen_returns_none_when_the_screen_is_now_too_small():
    """Simulates an undocked laptop: the geometry was saved on a bigger
    external monitor that isn't connected anymore."""
    geometry = window_state.WindowGeometry(width=2400, height=1400, x=100, y=100)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1366, screen_height=768, min_width=640, min_height=480
    )
    assert result is None


def test_clamp_to_screen_returns_none_when_geometry_is_smaller_than_the_minimum():
    geometry = window_state.WindowGeometry(width=300, height=200, x=0, y=0)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result is None


def test_clamp_to_screen_preserves_maximized_flag():
    geometry = window_state.WindowGeometry(width=1000, height=700, x=100, y=100, maximized=True)
    result = window_state.clamp_to_screen(
        geometry, screen_width=1920, screen_height=1080, min_width=640, min_height=480
    )
    assert result.maximized is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_window_state.py -v -k clamp_to_screen`
Expected: FAIL with `AttributeError: module 'src.window_state' has no attribute 'clamp_to_screen'`.

- [ ] **Step 3: Implement `clamp_to_screen`**

```python
# daemon-python/src/window_state.py (append)


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_window_state.py -v`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/window_state.py daemon-python/tests/test_window_state.py
git commit -m "feat(daemon): add pure clamp_to_screen for restored window geometry"
```

---

### Task 7: `main.py` — set DPI awareness before any window can be created

**Files:**
- Modify: `daemon-python/src/main.py`
- Test: `daemon-python/tests/test_main.py`

**Interfaces:**
- Consumes: `ui_kit.set_dpi_awareness()` (Task 2).

- [ ] **Step 1: Write failing test**

```python
# daemon-python/tests/test_main.py (append)
def test_main_sets_dpi_awareness_before_anything_else(_legacy_install, monkeypatch):
    """DPI awareness must be requested once per process, before the tray
    or a settings window can create a `tk.Tk()` — the migration-shim path
    is reused here purely because it's the shortest path through `main()`
    that this test fixture already short-circuits."""
    calls = []
    monkeypatch.setattr(main_module.ui_kit, "set_dpi_awareness", lambda: calls.append(True))

    main_module.main([])

    assert calls == [True]


def test_resync_also_sets_dpi_awareness(monkeypatch, tmp_path):
    """Headless `--resync` never opens a window, but setting awareness is
    a harmless no-op off-Windows/without a window, so it's simplest to set
    it unconditionally at the top of `main()` rather than special-casing
    the flag."""
    calls = []
    monkeypatch.setattr(main_module.ui_kit, "set_dpi_awareness", lambda: calls.append(True))
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.delenv("HOTS_API_BASE_URL", raising=False)
    monkeypatch.delenv("HOTS_ACCESS_TOKEN", raising=False)

    main_module.main(["--resync", str(tmp_path / "replays")])

    assert calls == [True]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_main.py -v`
Expected: FAIL with `AttributeError: module 'src.main' has no attribute 'ui_kit'`.

- [ ] **Step 3: Wire it up in `main.py`**

```python
# daemon-python/src/main.py — add to imports:
from . import accounts_discovery, api_client, ui_kit, updater

# daemon-python/src/main.py — first line inside `def main(...)`, before
# `logging.basicConfig(...)`:
def main(argv: list[str] | None = None) -> int:
    ui_kit.set_dpi_awareness()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_main.py -v`
Expected: PASS (all `test_main.py` tests, including the 2 new ones).

- [ ] **Step 5: Run the full daemon suite to confirm no regression**

Run: `cd daemon-python && pytest -q`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add daemon-python/src/main.py daemon-python/tests/test_main.py
git commit -m "feat(daemon): request Per-Monitor-V2 DPI awareness at startup"
```

---

### Task 8: `gui.py` — DPI-scaled fonts through `_apply_dark_style`

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `ui_kit.Fonts`, `ui_kit.dpi_scale_factor` (Task 1).

No automated test (constructing a real `tk.Tk()`/`ttk.Style()` requires a display — see Global
Constraints); verified by hand in Task 11.

- [ ] **Step 1: Import `ui_kit` in `gui.py`**

```python
# daemon-python/src/gui.py — add near the other local imports:
from . import ui_kit
```

- [ ] **Step 2: Change `_apply_dark_style` to take a `Fonts` and use it everywhere a font tuple is hardcoded**

```python
# daemon-python/src/gui.py — replace the existing `def _apply_dark_style() -> None:` and its body's
# hardcoded ("Segoe UI", N[, style]) tuples:
def _apply_dark_style(fonts: ui_kit.Fonts) -> None:
    """Builds the shared dark ttk theme -- called every time a window is
    created (see the original docstring for why: each `tk.Tk()` has its
    own ttk style database). `fonts` is DPI-scaled by the caller via
    `ui_kit.Fonts.for_scale(ui_kit.dpi_scale_factor(root))` so text stays
    readable (not bitmap-scaled blurry) on a 125%/150% display."""
    style = ttk.Style()
    style.theme_use("clam")
    style.configure("TFrame", background=_BG)
    style.configure("Panel.TFrame", background=_PANEL)
    style.configure("TLabel", background=_BG, foreground=_TEXT, font=fonts.body)
    style.configure("Panel.TLabel", background=_PANEL, foreground=_TEXT, font=fonts.body)
    style.configure("Muted.TLabel", background=_BG, foreground=_TEXT_MUTED, font=fonts.muted)
    style.configure(
        "PanelMuted.TLabel", background=_PANEL, foreground=_TEXT_MUTED, font=fonts.muted
    )
    style.configure(
        "SectionHeader.TLabel", background=_PANEL, foreground=_TEXT_MUTED, font=fonts.section
    )
    style.configure("Title.TLabel", background=_BG, foreground=_TEXT, font=fonts.title)
    style.configure("Link.TLabel", background=_PANEL, foreground=_ACCENT, font=fonts.link)
    style.configure(
        "Accent.TButton",
        background=_ACCENT,
        foreground="#0f1220",
        font=fonts.button_bold,
        padding=(14, 8),
        borderwidth=0,
    )
    style.map(
        "Accent.TButton", background=[("active", "#8aa3ff"), ("disabled", "#3a4066")]
    )
    style.configure(
        "Ghost.TButton",
        background=_BG,
        foreground=_TEXT_MUTED,
        font=fonts.button,
        padding=(14, 8),
        borderwidth=0,
    )
    style.map("Ghost.TButton", background=[("active", _PANEL)])
    style.configure("TNotebook", background=_BG, borderwidth=0)
    style.configure(
        "TNotebook.Tab",
        background=_BG,
        foreground=_TEXT_MUTED,
        padding=(16, 8),
        font=fonts.button,
        borderwidth=0,
    )
    style.map(
        "TNotebook.Tab",
        background=[("selected", _PANEL)],
        foreground=[("selected", _TEXT)],
    )
    style.configure(
        "TProgressbar",
        background=_ACCENT,
        troughcolor=_FIELD_BG,
        borderwidth=0,
        thickness=8,
    )
```

- [ ] **Step 3: Update both call sites to compute and pass `Fonts`**

```python
# daemon-python/src/gui.py — in `_UpdateProgressWindow.__init__`, replace
# `_apply_dark_style()` with:
        fonts = ui_kit.Fonts.for_scale(ui_kit.dpi_scale_factor(root))
        _apply_dark_style(fonts)

# daemon-python/src/gui.py — in `_SettingsWindow.__init__`, replace the
# existing `_apply_dark_style()` call with:
        self._fonts = ui_kit.Fonts.for_scale(ui_kit.dpi_scale_factor(root))
        _apply_dark_style(self._fonts)
```

- [ ] **Step 4: Run the full daemon suite (no `gui.py`-specific test exists, but this must not break imports/collection)**

Run: `cd daemon-python && pytest -q`
Expected: all tests pass (collection succeeds, meaning `gui.py` still imports cleanly).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "feat(daemon): scale settings-window fonts by the real display DPI"
```

---

### Task 9: `gui.py` — resizable window with restored/persisted geometry

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `window_state.WindowGeometry`, `window_state.load_window_geometry`,
  `window_state.save_window_geometry`, `window_state.clamp_to_screen` (Tasks 5–6).

No automated test for this task (real window geometry needs a display); verified by hand in Task 11
(covers: first open, reopen at the same size/position, resize-then-reopen, maximize-then-reopen,
and a saved geometry from a since-removed external monitor falling back to centered).

- [ ] **Step 1: Import `window_state` and add the minimum-size constants**

```python
# daemon-python/src/gui.py — add near the other local imports:
from . import window_state

# daemon-python/src/gui.py — near the other module-level constants (after
# _DEBOUNCE_MS):
# Floor for `root.minsize(...)` once the old worst-case-measured lock is
# removed (see `_apply_window_geometry`) — a real minimum below which the
# Config tab's fields would start overlapping, not a worst-case content size.
_MIN_WINDOW_WIDTH = 640
_MIN_WINDOW_HEIGHT = 520
```

- [ ] **Step 2: Delete the old fixed-size machinery**

Remove from `daemon-python/src/gui.py`:
- The constants `_SYNCING_LABEL_MAX_CHARS`, `_ERROR_LABEL_MAX_CHARS`, `_SKIPPED_LABEL_MAX_CHARS`,
  `_UPDATE_STATUS_MAX_CHARS`, `_DRAFT_CAPTURE_STATUS_MAX_CHARS`, `_TEST_CAPTURE_STATUS_MAX_CHARS`
  (lines 68–73) and their explaining comment block.
- The `_truncate` function (around line 144).
- The `_center` and `_measure_worst_case_size` methods on `_SettingsWindow` (near the end of the
  class, right after `_open_token_link`).
- `root.resizable(False, False)` in `_SettingsWindow.__init__`.

Every `_truncate(expr, SOME_MAX_CHARS)` call site becomes just `expr` (9 call sites — grep
`_truncate(` in `gui.py` to find all of them before deleting the function, so none are missed and
none are left calling a now-undefined name). `_LABEL_WRAPLENGTH` and the `wraplength=` usages that
reference it are **kept**: wrapping long text onto multiple lines is unrelated to truncating it, and
still desirable inside a scrollable tab.

- [ ] **Step 3: Add geometry restore/persist to `_SettingsWindow`**

```python
# daemon-python/src/gui.py — in `_SettingsWindow.__init__`, add to the
# instance-attribute block (near `self._closed = False`):
        self._geometry_save_job: str | None = None

# daemon-python/src/gui.py — in `_SettingsWindow.__init__`, replace:
#     root.resizable(False, False)
# with nothing (window stays resizable, the tk default) and, after
# `self._build_ui()` / where `self._center()` used to be called, call:
        self._apply_window_geometry()
        self._root.bind("<Configure>", self._on_geometry_changed)

# daemon-python/src/gui.py — new methods on `_SettingsWindow` (add them
# where `_center`/`_measure_worst_case_size` used to be):
    def _apply_window_geometry(self) -> None:
        """Restores the previous session's window size/position (clamped
        to the current screen) or falls back to a natural, centered size
        derived from the window's actual content -- every tab body now
        lives in a `ui_kit.ScrollableFrame` (see `_build_tab`), so unlike
        the old `_measure_worst_case_size`, the window no longer needs to
        be sized for the longest content any label could ever show."""
        self._root.update_idletasks()
        min_width = max(self._root.winfo_reqwidth(), _MIN_WINDOW_WIDTH)
        min_height = max(self._root.winfo_reqheight(), _MIN_WINDOW_HEIGHT)
        self._root.minsize(min_width, min_height)

        saved = window_state.load_window_geometry()
        clamped = (
            window_state.clamp_to_screen(
                saved,
                self._root.winfo_screenwidth(),
                self._root.winfo_screenheight(),
                min_width=min_width,
                min_height=min_height,
            )
            if saved is not None
            else None
        )
        if clamped is not None:
            self._root.geometry(f"{clamped.width}x{clamped.height}+{clamped.x}+{clamped.y}")
            if clamped.maximized:
                self._root.state("zoomed")
            return

        x = (self._root.winfo_screenwidth() - min_width) // 2
        y = (self._root.winfo_screenheight() - min_height) // 3
        self._root.geometry(f"{min_width}x{min_height}+{x}+{y}")

    def _on_geometry_changed(self, event: "tk.Event") -> None:
        if event.widget is not self._root or self._closed:
            return
        if self._geometry_save_job is not None:
            self._root.after_cancel(self._geometry_save_job)
        self._geometry_save_job = self._root.after(_DEBOUNCE_MS, self._save_geometry_now)

    def _save_geometry_now(self) -> None:
        self._geometry_save_job = None
        if self._closed:
            return
        maximized = self._root.state() == "zoomed"
        if maximized:
            # Preserve the last known non-maximized size/position so
            # un-maximizing later has somewhere sane to restore to.
            previous = window_state.load_window_geometry()
            geometry = window_state.WindowGeometry(
                width=previous.width if previous else self._root.winfo_width(),
                height=previous.height if previous else self._root.winfo_height(),
                x=previous.x if previous else self._root.winfo_x(),
                y=previous.y if previous else self._root.winfo_y(),
                maximized=True,
            )
        else:
            geometry = window_state.WindowGeometry(
                width=self._root.winfo_width(),
                height=self._root.winfo_height(),
                x=self._root.winfo_x(),
                y=self._root.winfo_y(),
                maximized=False,
            )
        window_state.save_window_geometry(geometry)
```

- [ ] **Step 4: Flush pending geometry saves on close**

`_stop_background_jobs`'s existing first line is `self._closed = True` (checked, guard-first, so
every other job-cancellation in that method is inert once it runs) — `_save_geometry_now` checks
that same flag and would silently no-op if called afterwards. The flush has to happen *before* that
line:

```python
# daemon-python/src/gui.py — in `_stop_background_jobs`, insert as the new
# first lines, before the existing `self._closed = True`:
    def _stop_background_jobs(self) -> None:
        if self._geometry_save_job is not None:
            self._root.after_cancel(self._geometry_save_job)
            self._geometry_save_job = None
            self._save_geometry_now()
        self._closed = True
        # ... existing body unchanged from here (the `_live_stats_job` /
        # `_update_status_job` / `_draft_capture_status_job` /
        # `_test_capture_countdown_job` cancellations) ...
```

- [ ] **Step 5: Fix the two remaining references to deleted names**

Search `daemon-python/src/gui.py` for `_ERROR_LABEL_MAX_CHARS` after Step 2's deletions — the
`_show_error` method used it via `_truncate(message, _ERROR_LABEL_MAX_CHARS)`; per Step 2 that
becomes:

```python
# daemon-python/src/gui.py — in `_show_error`:
    def _show_error(self, message: str) -> None:
        self._error_label.configure(text=message)
```

Also update the stale comment (just above the `self._skipped_count_label.configure(...)` call
inside the sync-status refresh method) that still explains a layout constraint from the deleted
worst-case-sizing scheme:

```python
# daemon-python/src/gui.py — replace:
            # Already counted inside `synced` above (not a failure -- see
            # `DaemonStatus.skipped_ai_player`'s docstring), called out on
            # its own full-width row rather than appended to the narrow
            # "Synchronisées" column so a 3-digit count can't push the
            # "En cours de synchronisation" column past this window's fixed
            # size (see `_measure_worst_case_size`).
# with:
            # Already counted inside `synced` above (not a failure -- see
            # `DaemonStatus.skipped_ai_player`'s docstring), called out on
            # its own full-width row rather than appended to the narrow
            # "Synchronisées" column so a 3-digit count can't push that
            # column's width around.
```

- [ ] **Step 6: Run the full daemon suite**

Run: `cd daemon-python && pytest -q`
Expected: all tests pass (proves `gui.py` still imports and nothing else references a deleted name —
a leftover reference would be a `NameError` at class-body/import time or on first exercise, but since
there are no `gui.py` tests, also grep to be sure: `grep -rn "_truncate\|_measure_worst_case_size\|_center()\|_SYNCING_LABEL_MAX_CHARS\|_ERROR_LABEL_MAX_CHARS\|_SKIPPED_LABEL_MAX_CHARS\|_UPDATE_STATUS_MAX_CHARS\|_DRAFT_CAPTURE_STATUS_MAX_CHARS\|_TEST_CAPTURE_STATUS_MAX_CHARS" daemon-python/src/gui.py` must return nothing).

- [ ] **Step 7: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "feat(daemon): make the settings window resizable with persisted geometry"
```

---

### Task 10: `gui.py` — wrap every tab body in a `ScrollableFrame`

**Files:**
- Modify: `daemon-python/src/gui.py`

**Interfaces:**
- Consumes: `ui_kit.ScrollableFrame` (Task 4).

No automated test (real widget layout); verified by hand in Task 11 (long account lists / error
text must scroll instead of clipping or growing the window).

- [ ] **Step 1: Change `_build_tab` to build content inside a `ScrollableFrame`**

```python
# daemon-python/src/gui.py — replace the existing `_build_tab`:
    def _build_tab(self, notebook: ttk.Notebook, key: str, title: str) -> ttk.Frame:
        tab = ttk.Frame(notebook, style="TFrame")
        notebook.add(tab, text=title)
        scrollable = ui_kit.ScrollableFrame(tab, background=_BG)
        scrollable.outer.pack(fill="both", expand=True)
        scrollable.content.configure(padding=18)
        self._tabs[key] = (notebook, tab, title)
        return scrollable.content
```

Every call site (`_build_config_tab`, `_build_draft_tab`, `_build_sync_tab`, `_build_update_tab`)
already receives whatever `_build_tab` returns as its `parent` and builds widgets into it with
`.grid`/`.pack` — no change needed there, since `scrollable.content` is a `ttk.Frame` just like the
old `tab` was.

- [ ] **Step 2: Run the full daemon suite**

Run: `cd daemon-python && pytest -q`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "feat(daemon): scroll each settings-window tab instead of locking window size to it"
```

---

### Task 11: Manual verification (required — no `gui.py` automated coverage exists)

**Files:** none (verification only).

- [ ] **Step 1:** Run the settings window in dev: `cd daemon-python && python -m src.main` with no
  existing config (first run) and again after `--resync`-ing once a config exists (reopen). Confirm:
  - The window opens, is resizable by dragging an edge/corner, and never grows or shrinks on its own
    while switching tabs or while a status label updates (e.g. leave the Synchronisation tab open
    while a sync runs).
  - Every tab (Config, Draft Live, Synchronisation, and Update when `updater.IS_FROZEN` — or run
    with `updater.IS_FROZEN` monkeypatched `True` locally to see it in dev) scrolls with the mouse
    wheel when content overflows the window height, instead of clipping.
  - A long error message (temporarily force one, e.g. an invalid token) wraps instead of being cut
    with an ellipsis.
- [ ] **Step 2:** Resize the window, close it, reopen it (from the tray's "Ouvrir les paramètres") —
  confirm it reopens at the same size and position. Move it to a different position and resize again
  to a different size; reopen; confirm the new size/position is what's restored. Maximize it, close,
  reopen; confirm it reopens maximized.
- [ ] **Step 3:** Simulate the "screen no longer fits it" case: manually write an oversized geometry
  to `%APPDATA%\hots-analytics\window.json` (e.g. `{"width": 5000, "height": 3000, "x": 0, "y": 0,
  "maximized": false}`), reopen the window, and confirm it falls back to the default centered size
  instead of erroring or opening off-screen.
- [ ] **Step 4:** On a display running at 100%, 125%, and 150% Windows scaling (`Réglages > Système >
  Affichage > Mise à l'échelle`), confirm the window's text is crisp (not blurry/bitmap-scaled) and
  legible, and that the layout doesn't clip or overlap at any of the three scales.
- [ ] **Step 5:** At a small resolution (1366×768) and a large one (or a scaled-down 4K), confirm the
  window's `minsize` doesn't force it larger than the screen and that scrolling still works within
  the smaller size.
- [ ] **Step 6:** Run `bun run typecheck` and `bun run build` at the repo root (this plan touches no
  TypeScript, but the roadmap's prod-exploitable bar requires both green before considering any
  daemon change shippable).

Run: `cd .. && bun run typecheck && bun run build`
Expected: both succeed.

- [ ] **Step 7:** Push the branch (no merge — see Global Constraints).

```bash
git push -u origin feat/daemon-ux-redesign
```

- [ ] **Step 8: Commit any fixes found during manual verification, then stop.**

Do not merge `feat/daemon-ux-redesign` into `main` from this plan. Report what was verified, any
issue found and fixed, and hand off: B2 (full widget kit: `Card`, `Button` variants, `StatusPill`,
`Table`, health banner) is the next checkpoint on this same branch, in a fresh session, per
`docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md`.

---

## Out of scope for this plan (explicitly deferred)

- `HealthSummary` / `health.py`, the global health banner, `Card`/`Button` variants/`StatusPill`/
  `Table` widgets, the Synchronisation control panel, the first-run wizard, the Journal view, tray
  tooltip/menu changes, and `daemon-python/README.md`'s architecture section + Option B revisit
  criteria: all belong to B2/B3/B4 per the roadmap's checkpoint table and are not touched here.
- No `PARSER_VERSION`/`MIN_PARSER_VERSION` change: this plan touches no parsing or wire-format code.
