# C2 Daemon UX — B2: Widget Kit + Global Health Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `daemon-python/src/ui_kit.py`'s widget kit (tokens, containers, actions, feedback, inputs, table) and add a `health.py` module that derives one global health state for the settings window, then wire a health banner into `gui.py` above the notebook — visual/UX only, per the roadmap's B2 checkpoint.

**Architecture:** `ui_kit.py` stays dependency-free of `gui.py` and free of any module-level `tkinter` import (lazy-imported inside each class's `__init__`, matching B1's `ScrollableFrame`), so its pure logic (tone/style mapping, contrast ratios, table sort/filter, `Spacing`/`Palette` tokens) is unit-testable headless. `health.py` is likewise dependency-free of `gui.py`/tkinter, deriving a `HealthSummary` from plain inputs (`DaemonStatus`, booleans, counts, a `datetime`) so every one of its states is a synthetic-input unit test. `gui.py` is the only place that imports both and wires real widgets to real state — the widget kit itself stays either migrated in place (Card, SectionHeader, Button, Banner) or shipped unwired-but-tested (Field, Toggle, SegmentedControl, StatusPill, EmptyState, InlineError, Table), per the roadmap's "visual/UX only" scope for B2.

**Tech Stack:** Python 3, stdlib `tkinter`/`ttk`, `pytest` (daemon test suite), SQLite via the existing `sync_state.py`.

**Spec:** `docs/superpowers/specs/2026-09-18-daemon-ux-redesign-design.md` (sections: Components > Widget kit, Global health banner, Error handling, Accessibility, Testing) and `docs/superpowers/specs/2026-09-18-daemon-platform-roadmap-design.md` (B2 checkpoint row: "widget kit + global health banner + states | visual/UX only").

## Global Constraints

- B2 is visual/UX only (roadmap checkpoint table): do not build the Synchronisation control panel's data/actions (C3), do not build the first-run wizard (B4), do not touch `tray.py`.
- No new asset/icon pipeline; status is communicated with glyph + word text, never color alone (spec Accessibility section).
- Any new status/tone color must reach a WCAG contrast ratio of at least 4.5:1 against both `Palette.bg` and `Palette.panel` (spec Accessibility section).
- French banner copy must match the spec's Global health banner table exactly, including singular/plural wording.
- `ui_kit.py` has no module-level `tkinter`/`ttk` import; every class that constructs real widgets imports them locally inside `__init__` (established in B1, keeps the module importable under pytest's headless CI runner).
- `health.py` has no `tkinter` or `gui.py` import; `compute_health_summary` is a pure function of its arguments (an injectable `now` replaces `datetime.now()` so tests are deterministic).
- Pure logic gets unit tests in `test_ui_kit.py` / `test_health.py`; real Tk widget construction is manual-verification-only, documented in the widget's docstring (same convention as B1's `ScrollableFrame`).
- Every worker-thread result handed back to Tk keeps flowing through `_after_if_open`/`root.after`, and is dropped once `self._closed` is set (established in B1, `gui.py`'s `_after_if_open` docstring).
- Never push or merge `daemon-python` changes directly to `main`.

---

### Task 1: `ui_kit.py` — `Palette.warn`, `Spacing`, and a contrast-ratio regression test

**Files:**
- Modify: `daemon-python/src/ui_kit.py:95-125`
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.Palette.warn: str`, `ui_kit.DEFAULT_PALETTE.warn == "#f2c14e"`, `ui_kit.contrast_ratio(hex_a: str, hex_b: str) -> float`, `ui_kit.Spacing` (frozen dataclass: `xs=4, sm=8, md=12, lg=18, xl=24`), `ui_kit.DEFAULT_SPACING: Spacing`.

- [ ] **Step 1: Write the failing tests**

Add to `daemon-python/tests/test_ui_kit.py` (add `import pytest` near the top with the other imports):

```python
def test_contrast_ratio_black_on_white_is_maximum():
    assert ui_kit.contrast_ratio("#000000", "#ffffff") == pytest.approx(21.0, abs=0.01)


def test_contrast_ratio_is_symmetric():
    assert ui_kit.contrast_ratio("#1c1f2e", "#f2c14e") == ui_kit.contrast_ratio(
        "#f2c14e", "#1c1f2e"
    )


def test_default_palette_warn_meets_accessibility_contrast_target_on_bg():
    assert ui_kit.contrast_ratio(ui_kit.DEFAULT_PALETTE.warn, ui_kit.DEFAULT_PALETTE.bg) >= 4.5


def test_default_palette_warn_meets_accessibility_contrast_target_on_panel():
    assert (
        ui_kit.contrast_ratio(ui_kit.DEFAULT_PALETTE.warn, ui_kit.DEFAULT_PALETTE.panel) >= 4.5
    )


def test_default_palette_text_muted_meets_accessibility_contrast_target():
    assert ui_kit.contrast_ratio(ui_kit.DEFAULT_PALETTE.text_muted, ui_kit.DEFAULT_PALETTE.bg) >= 4.5
    assert (
        ui_kit.contrast_ratio(ui_kit.DEFAULT_PALETTE.text_muted, ui_kit.DEFAULT_PALETTE.panel)
        >= 4.5
    )


def test_default_spacing_matches_todays_hardcoded_padding_values():
    assert ui_kit.DEFAULT_SPACING == ui_kit.Spacing(xs=4, sm=8, md=12, lg=18, xl=24)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -k "contrast or spacing" -v`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'contrast_ratio'` (and similar for `Spacing`/`warn`).

- [ ] **Step 3: Implement `contrast_ratio`, `Spacing`, and `Palette.warn`**

In `daemon-python/src/ui_kit.py`, add after `set_dpi_awareness` (before the `Palette` dataclass):

```python
def _relative_luminance(hex_color: str) -> float:
    """WCAG relative luminance of a `#rrggbb` color, 0 (black) to 1
    (white) -- pure hex/arithmetic, no Tk involved."""
    hex_color = hex_color.lstrip("#")
    channels = []
    for i in (0, 2, 4):
        c = int(hex_color[i : i + 2], 16) / 255.0
        c = c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        channels.append(c)
    r, g, b = channels
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(hex_a: str, hex_b: str) -> float:
    """WCAG contrast ratio between two `#rrggbb` colors (>= 1.0, higher is
    more contrast) -- backs the palette's own regression tests so new
    status/tone colors stay above the spec's 4.5:1 accessibility target
    (Accessibility section) without eyeballing it by hand."""
    l1 = _relative_luminance(hex_a) + 0.05
    l2 = _relative_luminance(hex_b) + 0.05
    return max(l1, l2) / min(l1, l2)


@dataclass(frozen=True)
class Spacing:
    """Named spacing tokens (pixels at 96 DPI) so container padding stops
    being hardcoded per call site (e.g. `Card`'s inner padding) and can be
    tuned once. Values match today's hardcoded paddings across `gui.py`
    (18px card padding, 12px between stacked cards, etc.) — a no-visual-
    change extraction, same as `Palette`/`Fonts` before it."""

    xs: int = 4
    sm: int = 8
    md: int = 12
    lg: int = 18
    xl: int = 24


DEFAULT_SPACING = Spacing()
```

Then modify the `Palette` dataclass and `DEFAULT_PALETTE`:

```python
@dataclass(frozen=True)
class Palette:
    """A small, dark, "gamer tool" color set. Values match `gui.py`'s
    previous module-level color constants exactly (this is a no-visual-
    change extraction). `warn` was added in B2 for the health banner's
    "degraded"/"syncing" tones; it and `text_muted` both meet the spec's
    4.5:1 contrast target against `bg` and `panel` (see
    `test_default_palette_warn_meets_accessibility_contrast_target_on_bg`
    and its siblings)."""

    bg: str
    panel: str
    field_bg: str
    field_bg_focus: str
    text: str
    text_muted: str
    accent: str
    ok: str
    warn: str
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
    warn="#f2c14e",
    error="#ef5b5b",
    neutral="#8b90ad",
)
```

Update the existing `test_default_palette_matches_todays_hardcoded_colors` test in `test_ui_kit.py` to include `warn="#f2c14e"` in both the expected `Palette(...)` call and confirm it still passes (it constructs `ui_kit.Palette(...)` positionally-by-keyword, so adding the new required field to both the dataclass and the test keeps it in sync).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (all tests, including the pre-existing `test_default_palette_matches_todays_hardcoded_colors` you just updated).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add Palette.warn, Spacing tokens, and a contrast-ratio helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ui_kit.py` — `Card` and `SectionHeader`, migrated into `gui.py`

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `Card`, `SectionHeader`)
- Modify: `daemon-python/src/gui.py:609-616, 663-669, 701-706, 830-836, 936-941, 1005-1010, 1352-1355, 1492-1495`

**Interfaces:**
- Consumes: `ui_kit.DEFAULT_SPACING` (Task 1).
- Produces: `ui_kit.Card(parent, *, palette: Palette, padding: int | None = None)` exposing `.outer` (a `tk.Frame` — pack/grid this into the parent) and `.content` (a `ttk.Frame`, styled `"Panel.TFrame"` — put children in this). `ui_kit.SectionHeader(parent, *, text: str) -> ttk.Label`.

- [ ] **Step 1: Implement `Card` and `SectionHeader`**

Not unit-tested (constructing either needs a real Tk interpreter — same reason `ScrollableFrame` isn't tested; verified by hand once wired into `gui.py` in this same task). Add to `daemon-python/src/ui_kit.py`, after `ScrollableFrame`:

```python
class Card:
    """A panel-colored container with padded inner content -- the
    `tk.Frame` (panel-colored) + `ttk.Frame` (`"Panel.TFrame"`, padded)
    pair repeated throughout `gui.py`'s Config/Draft/Update tabs. Exposes
    `.outer` (pack/grid this into the parent) and `.content` (put children
    in this), matching `ScrollableFrame`'s `.outer`/`.content` split.
    """

    def __init__(self, parent: tk.Misc, *, palette: Palette, padding: int | None = None) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.outer = tk.Frame(parent, background=palette.panel)
        self.content = ttk.Frame(
            self.outer,
            style="Panel.TFrame",
            padding=padding if padding is not None else DEFAULT_SPACING.lg,
        )
        self.content.pack(fill="x")


def SectionHeader(parent: tk.Misc, *, text: str) -> "ttk.Label":
    """A `ttk.Label` styled as a card's all-caps section title (the
    `"SectionHeader.TLabel"` style `gui.py`'s `_apply_dark_style` defines)
    -- a thin factory rather than a class since it's just a styled label
    with no behavior of its own."""
    from tkinter import ttk

    return ttk.Label(parent, text=text, style="SectionHeader.TLabel")
```

- [ ] **Step 2: Migrate the 8 existing `card = tk.Frame(parent, bg=_PANEL)` blocks in `gui.py`**

Each site follows one of two shapes (with or without `pady=(0, 12)` on the outer pack). Replace each with the `Card` equivalent, keeping every other line (grid/pack calls on `inner`'s children) unchanged.

`gui.py:609-613` (`_build_connexion_section`):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x", pady=(0, 12))
        inner = card.content
        inner.grid_columnconfigure(0, weight=1, minsize=340)
```

`gui.py:663-667` (storage section, same shape):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x", pady=(0, 12))
        inner = card.content
```

`gui.py:701-704` (startup section — no `pady` on the outer pack):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x")
        inner = card.content
```

`gui.py:830-834` (raccourci section, same shape as connexion):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x", pady=(0, 12))
        inner = card.content
```

`gui.py:936-939` (capture section, same shape):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x", pady=(0, 12))
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x", pady=(0, 12))
        inner = card.content
```

`gui.py:1005-1008` (état section — no `pady`):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x")
        inner = card.content
```

`gui.py:1352-1355` (update-tab version card — no `pady`):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x")
        inner = card.content
```

`gui.py:1492-1495` (update-tab controls card — no `pady`, has `inner.grid_columnconfigure(0, weight=1, minsize=340)` right after):
```python
# before
        card = tk.Frame(parent, bg=_PANEL)
        card.pack(fill="x")
        inner = ttk.Frame(card, style="Panel.TFrame", padding=18)
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1, minsize=340)

# after
        card = ui_kit.Card(parent, palette=ui_kit.DEFAULT_PALETTE)
        card.outer.pack(fill="x")
        inner = card.content
        inner.grid_columnconfigure(0, weight=1, minsize=340)
```

- [ ] **Step 3: Migrate the 6 `SectionHeader.TLabel` label calls**

`gui.py:615-617`:
```python
# before
        ttk.Label(inner, text="CONNEXION", style="SectionHeader.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )

# after
        ui_kit.SectionHeader(inner, text="CONNEXION").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 10)
        )
```

Apply the same `ttk.Label(inner, text=<TEXT>, style="SectionHeader.TLabel")` → `ui_kit.SectionHeader(inner, text=<TEXT>)` substitution, keeping the trailing `.grid(...)` call exactly as-is, at:
- `gui.py:669` (`text="STOCKAGE"`)
- `gui.py:706` (`text="DÉMARRAGE"`)
- `gui.py:836` (`text="RACCOURCI"`)
- `gui.py:941` (`text="CAPTURE"`)
- `gui.py:1010` (`text="ÉTAT"`)

- [ ] **Step 4: Manual verification**

Run `python -m src.main` from `daemon-python/` (or reopen the settings window) and confirm every tab looks pixel-identical to before this task: card backgrounds, padding, and section header styling unchanged.

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/src/gui.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Card/SectionHeader, migrate gui.py's ad-hoc cards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ui_kit.py` — `Button` variants, migrated into `gui.py`

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `ButtonVariant`, `button_style`, `Button`)
- Modify: `daemon-python/src/gui.py:361-401` (`_apply_dark_style`, add two styles), and every `ttk.Button(..., style="Accent.TButton"|"Ghost.TButton", ...)` construction site plus the one dynamic `.configure(style=...)` restyle site (21 sites total, listed below).

**Interfaces:**
- Produces: `ui_kit.ButtonVariant` (`PRIMARY`, `GHOST`, `DANGER`, `LINK`), `ui_kit.button_style(variant: ButtonVariant) -> str`, `ui_kit.Button(parent, *, text: str, variant: ButtonVariant = ButtonVariant.GHOST, command=None) -> ttk.Button`.

- [ ] **Step 1: Write the failing test for the pure style-name mapping**

Add to `daemon-python/tests/test_ui_kit.py`:

```python
def test_button_style_maps_every_variant_to_a_ttk_style_name():
    assert ui_kit.button_style(ui_kit.ButtonVariant.PRIMARY) == "Accent.TButton"
    assert ui_kit.button_style(ui_kit.ButtonVariant.GHOST) == "Ghost.TButton"
    assert ui_kit.button_style(ui_kit.ButtonVariant.DANGER) == "Danger.TButton"
    assert ui_kit.button_style(ui_kit.ButtonVariant.LINK) == "Link.TButton"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -k button_style -v`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'button_style'`.

- [ ] **Step 3: Implement `ButtonVariant`, `button_style`, `Button`**

Add near the top of `daemon-python/src/ui_kit.py` (with the other imports): `from enum import Enum`.

Add after `Card`/`SectionHeader`:

```python
class ButtonVariant(str, Enum):
    PRIMARY = "primary"
    GHOST = "ghost"
    DANGER = "danger"
    LINK = "link"


_BUTTON_VARIANT_STYLES: dict[ButtonVariant, str] = {
    ButtonVariant.PRIMARY: "Accent.TButton",
    ButtonVariant.GHOST: "Ghost.TButton",
    ButtonVariant.DANGER: "Danger.TButton",
    ButtonVariant.LINK: "Link.TButton",
}


def button_style(variant: ButtonVariant) -> str:
    """The ttk style name for a button variant -- pure, and exposed
    separately from `Button` so code that restyles an *existing* button at
    runtime (e.g. `gui.py`'s update-tab button, which flips between
    primary/ghost depending on update phase) can reuse the same variant
    vocabulary instead of hardcoding style strings a second time."""
    return _BUTTON_VARIANT_STYLES[variant]


def Button(
    parent: tk.Misc,
    *,
    text: str,
    variant: ButtonVariant = ButtonVariant.GHOST,
    command=None,
) -> "ttk.Button":
    """A `ttk.Button` pinned to one of the theme's four button styles --
    thin factory (like `SectionHeader`) so call sites say what a button
    *means* (primary/ghost/danger/link) instead of naming a ttk style
    string. `gui.py`'s `_apply_dark_style` still owns the actual style
    definitions; this only maps the vocabulary onto them."""
    from tkinter import ttk

    return ttk.Button(parent, text=text, style=button_style(variant), command=command)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -k button_style -v`
Expected: PASS.

- [ ] **Step 5: Extend `_apply_dark_style` with `Danger.TButton` and `Link.TButton`**

In `daemon-python/src/gui.py`, immediately after the existing `style.map("Ghost.TButton", background=[("active", _PANEL)])` line (line 401):

```python
    style.configure(
        "Danger.TButton",
        background=_ERROR,
        foreground="#0f1220",
        font=fonts.button_bold,
        padding=(14, 8),
        borderwidth=0,
    )
    style.map(
        "Danger.TButton", background=[("active", "#ff7b7b"), ("disabled", "#5a3a3a")]
    )
    style.configure(
        "Link.TButton",
        background=_BG,
        foreground=_ACCENT,
        font=fonts.link,
        padding=(0, 0),
        borderwidth=0,
    )
    style.map("Link.TButton", foreground=[("active", "#8aa3ff")])
```

- [ ] **Step 6: Migrate every `ttk.Button(..., style=...)` construction site to `ui_kit.Button(...)`**

Apply the following before/after replacements in `daemon-python/src/gui.py` (all 20 constructor sites; `style="Accent.TButton"` → `variant=ui_kit.ButtonVariant.PRIMARY`, `style="Ghost.TButton"` → `variant=ui_kit.ButtonVariant.GHOST`):

`gui.py:303-308`:
```python
# before
        self._open_fallback_button = ttk.Button(
            outer,
            text="📁 Ouvrir le dossier",
            style="Ghost.TButton",
            command=self._open_fallback_folder,
        )

# after
        self._open_fallback_button = ui_kit.Button(
            outer,
            text="📁 Ouvrir le dossier",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._open_fallback_folder,
        )
```

`gui.py:316-321`:
```python
# before
        self._manual_download_button = ttk.Button(
            outer,
            text="⬇ Mise à jour manuelle",
            style="Accent.TButton",
            command=lambda: webbrowser.open(updater.release_page_url()),
        )

# after
        self._manual_download_button = ui_kit.Button(
            outer,
            text="⬇ Mise à jour manuelle",
            variant=ui_kit.ButtonVariant.PRIMARY,
            command=lambda: webbrowser.open(updater.release_page_url()),
        )
```

`gui.py:323-325`:
```python
# before
        self._close_button = ttk.Button(
            outer, text="Fermer", style="Ghost.TButton", command=root.destroy
        )

# after
        self._close_button = ui_kit.Button(
            outer, text="Fermer", variant=ui_kit.ButtonVariant.GHOST, command=root.destroy
        )
```

`gui.py:524-529`:
```python
# before
        ttk.Button(
            header,
            text="📁 Dossier de données",
            style="Ghost.TButton",
            command=self._open_data_folder,
        ).pack(side="right")

# after
        ui_kit.Button(
            header,
            text="📁 Dossier de données",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._open_data_folder,
        ).pack(side="right")
```

`gui.py:562-567`:
```python
# before
            ttk.Button(
                buttons,
                text="Debug",
                style="Ghost.TButton",
                command=self._open_debug_window,
            ).pack(side="left")

# after
            ui_kit.Button(
                buttons,
                text="Debug",
                variant=ui_kit.ButtonVariant.GHOST,
                command=self._open_debug_window,
            ).pack(side="left")
```

`gui.py:569-571`:
```python
# before
        ttk.Button(
            buttons, text=cancel_text, style="Ghost.TButton", command=self._on_close
        ).pack(side="right")

# after
        ui_kit.Button(
            buttons, text=cancel_text, variant=ui_kit.ButtonVariant.GHOST, command=self._on_close
        ).pack(side="right")
```

`gui.py:572-574`:
```python
# before
        ttk.Button(
            buttons, text="Enregistrer", style="Accent.TButton", command=self._save
        ).pack(side="right", padx=(0, 10))

# after
        ui_kit.Button(
            buttons, text="Enregistrer", variant=ui_kit.ButtonVariant.PRIMARY, command=self._save
        ).pack(side="right", padx=(0, 10))
```

`gui.py:622-627`:
```python
# before
        self._connect_button = ttk.Button(
            connect_row,
            text="Connecter ce PC via le navigateur",
            style="Accent.TButton",
            command=self._connect_via_browser,
        )

# after
        self._connect_button = ui_kit.Button(
            connect_row,
            text="Connecter ce PC via le navigateur",
            variant=ui_kit.ButtonVariant.PRIMARY,
            command=self._connect_via_browser,
        )
```

`gui.py:680-682`:
```python
# before
        browse = ttk.Button(
            inner, text="Parcourir…", style="Ghost.TButton", command=self._browse_replays_dir
        )

# after
        browse = ui_kit.Button(
            inner,
            text="Parcourir…",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._browse_replays_dir,
        )
```

`gui.py:874-879`:
```python
# before
        self._draft_hotkey_record_btn = ttk.Button(
            hotkey_row,
            text="Modifier…",
            style="Ghost.TButton",
            command=self._start_hotkey_capture,
        )

# after
        self._draft_hotkey_record_btn = ui_kit.Button(
            hotkey_row,
            text="Modifier…",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._start_hotkey_capture,
        )
```

`gui.py:911-916`:
```python
# before
            self._hotkey_retry_btn = ttk.Button(
                status_row,
                text="Réessayer",
                style="Ghost.TButton",
                command=self._retry_hotkey_registration,
            )

# after
            self._hotkey_retry_btn = ui_kit.Button(
                status_row,
                text="Réessayer",
                variant=ui_kit.ButtonVariant.GHOST,
                command=self._retry_hotkey_registration,
            )
```

`gui.py:954-959`:
```python
# before
        self._test_capture_btn = ttk.Button(
            test_col,
            text="🔍 Tester la capture",
            style="Ghost.TButton",
            command=self._start_test_capture,
        )

# after
        self._test_capture_btn = ui_kit.Button(
            test_col,
            text="🔍 Tester la capture",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._start_test_capture,
        )
```

`gui.py:976-981`:
```python
# before
            ttk.Button(
                capture_col,
                text="📤 Capturer maintenant",
                style="Accent.TButton",
                command=self._start_manual_capture,
            ).pack(anchor="w")

# after
            ui_kit.Button(
                capture_col,
                text="📤 Capturer maintenant",
                variant=ui_kit.ButtonVariant.PRIMARY,
                command=self._start_manual_capture,
            ).pack(anchor="w")
```

`gui.py:1335-1337`:
```python
# before
        ttk.Button(
            body, text="Fermer", style="Ghost.TButton", command=win.destroy
        ).grid(row=6, column=0, columnspan=2, sticky="e", pady=(18, 0))

# after
        ui_kit.Button(
            body, text="Fermer", variant=ui_kit.ButtonVariant.GHOST, command=win.destroy
        ).grid(row=6, column=0, columnspan=2, sticky="e", pady=(18, 0))
```

`gui.py:1511-1516`:
```python
# before
            self._check_update_button = ttk.Button(
                button_row,
                text="Vérifier les mises à jour",
                style="Accent.TButton",
                command=self._on_check_update_clicked,
            )

# after
            self._check_update_button = ui_kit.Button(
                button_row,
                text="Vérifier les mises à jour",
                variant=ui_kit.ButtonVariant.PRIMARY,
                command=self._on_check_update_clicked,
            )
```

`gui.py:1519-1524`:
```python
# before
        self._view_log_button = ttk.Button(
            button_row,
            text="Voir le journal",
            style="Ghost.TButton",
            command=self._open_update_log,
        )

# after
        self._view_log_button = ui_kit.Button(
            button_row,
            text="Voir le journal",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._open_update_log,
        )
```

`gui.py:1537-1542`:
```python
# before
        self._manual_download_button = ttk.Button(
            button_row,
            text="⬇ Mise à jour manuelle",
            style="Ghost.TButton",
            command=self._open_manual_download,
        )

# after
        self._manual_download_button = ui_kit.Button(
            button_row,
            text="⬇ Mise à jour manuelle",
            variant=ui_kit.ButtonVariant.GHOST,
            command=self._open_manual_download,
        )
```

`gui.py:1554-1559`:
```python
# before
            self._open_fallback_button = ttk.Button(
                button_row,
                text="📁 Ouvrir le dossier",
                style="Ghost.TButton",
                command=self._open_fallback_folder,
            )

# after
            self._open_fallback_button = ui_kit.Button(
                button_row,
                text="📁 Ouvrir le dossier",
                variant=ui_kit.ButtonVariant.GHOST,
                command=self._open_fallback_folder,
            )
```

`gui.py:1894-1899`:
```python
# before
        ttk.Button(
            button_row, text="Fermer", style="Ghost.TButton", command=win.destroy
        ).pack(side="right")
        ttk.Button(
            button_row, text="Copier", style="Accent.TButton", command=_copy
        ).pack(side="right", padx=(0, 10))

# after
        ui_kit.Button(
            button_row, text="Fermer", variant=ui_kit.ButtonVariant.GHOST, command=win.destroy
        ).pack(side="right")
        ui_kit.Button(
            button_row, text="Copier", variant=ui_kit.ButtonVariant.PRIMARY, command=_copy
        ).pack(side="right", padx=(0, 10))
```

Then the one dynamic restyle site, `gui.py:1622-1626`:
```python
# before
        self._manual_download_button.configure(
            style="Accent.TButton"
            if status.phase is UpdatePhase.ERROR
            else "Ghost.TButton"
        )

# after
        self._manual_download_button.configure(
            style=ui_kit.button_style(
                ui_kit.ButtonVariant.PRIMARY
                if status.phase is UpdatePhase.ERROR
                else ui_kit.ButtonVariant.GHOST
            )
        )
```

- [ ] **Step 7: Manual verification**

Reopen the settings window (and the Debug/Update-log sub-windows, which also have buttons) and confirm every button looks and behaves exactly as before: same colors, same hover/disabled states, same click behavior.

- [ ] **Step 8: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/src/gui.py daemon-python/tests/test_ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Button variants, migrate gui.py's button call sites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ui_kit.py` — `Tone`, `StatusPill`, `EmptyState`, `InlineError` (kit-only)

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `Tone`, `tone_color`, `StatusPill`, `EmptyState`, `InlineError`)
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Consumes: `ui_kit.Palette` (Task 1, now has `.warn`).
- Produces: `ui_kit.Tone` (`INFO`, `OK`, `WARN`, `ERROR`, `NEUTRAL`), `ui_kit.tone_color(tone, palette) -> str`, `ui_kit.status_pill_text(tone, label) -> str`, `ui_kit.StatusPill`, `ui_kit.EmptyState`, `ui_kit.InlineError`. `Tone` is later reused by `Banner` (Task 7) so both widgets share one tone vocabulary.

Not wired into `gui.py` this checkpoint — the spec's widget kit lists these as reusable pieces; the roadmap scopes their actual use (replay-list empty states, per-row status, inline field errors) to later checkpoints. Shipped tested-but-unwired, same as `ScrollableFrame` was staged ahead of its Task 10 wiring in B1.

- [ ] **Step 1: Write the failing tests for the pure pieces**

Add to `daemon-python/tests/test_ui_kit.py`:

```python
def test_tone_color_maps_every_tone_to_a_palette_field():
    palette = ui_kit.DEFAULT_PALETTE
    assert ui_kit.tone_color(ui_kit.Tone.INFO, palette) == palette.accent
    assert ui_kit.tone_color(ui_kit.Tone.OK, palette) == palette.ok
    assert ui_kit.tone_color(ui_kit.Tone.WARN, palette) == palette.warn
    assert ui_kit.tone_color(ui_kit.Tone.ERROR, palette) == palette.error
    assert ui_kit.tone_color(ui_kit.Tone.NEUTRAL, palette) == palette.text_muted


def test_status_pill_text_prefixes_a_glyph_never_relying_on_color_alone():
    assert ui_kit.status_pill_text(ui_kit.Tone.OK, "Synchronisé") == "✓ Synchronisé"
    assert ui_kit.status_pill_text(ui_kit.Tone.ERROR, "Échec") == "✗ Échec"
    assert ui_kit.status_pill_text(ui_kit.Tone.WARN, "Partiel") == "! Partiel"
    assert ui_kit.status_pill_text(ui_kit.Tone.NEUTRAL, "En attente") == "• En attente"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -k "tone_color or status_pill_text" -v`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'Tone'`.

- [ ] **Step 3: Implement `Tone`, `tone_color`, `status_pill_text`, and the three widgets**

Add to `daemon-python/src/ui_kit.py`, after `Button`:

```python
class Tone(str, Enum):
    """A semantic vocabulary for status/feedback color, shared by
    `StatusPill` and `Banner` so both draw from one mapping instead of
    each hardcoding its own color lookup."""

    INFO = "info"
    OK = "ok"
    WARN = "warn"
    ERROR = "error"
    NEUTRAL = "neutral"


def tone_color(tone: Tone, palette: Palette) -> str:
    """Maps a semantic tone to its palette color -- pure, shared by
    `StatusPill` and `Banner`."""
    return {
        Tone.INFO: palette.accent,
        Tone.OK: palette.ok,
        Tone.WARN: palette.warn,
        Tone.ERROR: palette.error,
        Tone.NEUTRAL: palette.text_muted,
    }[tone]


_STATUS_PILL_GLYPHS: dict[Tone, str] = {
    Tone.OK: "✓",
    Tone.WARN: "!",
    Tone.ERROR: "✗",
    Tone.NEUTRAL: "•",
    Tone.INFO: "•",
}


def status_pill_text(tone: Tone, label: str) -> str:
    """Glyph + word, pure and unit-tested -- the spec's Accessibility
    section requires status is never encoded in color alone."""
    return f"{_STATUS_PILL_GLYPHS[tone]} {label}"


class StatusPill:
    """A small colored glyph+word badge (e.g. "✓ Synchronisé",
    "✗ Échec"). A `tk.Label`, not `ttk.Label`, since its foreground color
    varies per instance/update and a ttk style per color combination isn't
    worth the indirection for an always-inline widget."""

    def __init__(self, parent: tk.Misc, *, palette: Palette, fonts: Fonts) -> None:
        import tkinter as tk

        self._palette = palette
        self.label = tk.Label(
            parent, font=fonts.muted, background=palette.panel, padx=8, pady=2
        )

    def set(self, tone: Tone, text: str) -> None:
        self.label.configure(
            text=status_pill_text(tone, text), foreground=tone_color(tone, self._palette)
        )


class EmptyState:
    """A centered message for a panel with nothing to show yet (e.g. the
    Synchronisation table before the first sync ever runs) -- text plus an
    optional single action button. No icon, per the spec's Decision to add
    no new asset pipeline."""

    def __init__(self, parent: tk.Misc, *, palette: Palette, fonts: Fonts) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.frame = tk.Frame(parent, background=palette.panel)
        self._label = tk.Label(
            self.frame,
            text="",
            font=fonts.muted,
            background=palette.panel,
            foreground=palette.text_muted,
            wraplength=360,
            justify="center",
        )
        self._label.pack(pady=(24, 8))
        self._action_command = None
        self._action_button = ttk.Button(
            self.frame, text="", style="Accent.TButton", command=self._on_action_click
        )

    def _on_action_click(self) -> None:
        if self._action_command is not None:
            self._action_command()

    def set(self, *, message: str, action_label: str | None = None, on_action=None) -> None:
        self._label.configure(text=message)
        if action_label is not None and on_action is not None:
            self._action_command = on_action
            self._action_button.configure(text=action_label)
            self._action_button.pack(pady=(0, 24))
        else:
            self._action_command = None
            self._action_button.pack_forget()


class InlineError:
    """A one-line error message that only takes up space when it has
    something to say -- `pack_forget()`-ed when empty instead of showing
    an empty label. This is the everyday error surface (see the spec's
    Error handling section: no modal error dialogs)."""

    def __init__(self, parent: tk.Misc, *, palette: Palette, fonts: Fonts, wraplength: int = 400) -> None:
        import tkinter as tk

        self.label = tk.Label(
            parent,
            text="",
            font=fonts.muted,
            background=palette.bg,
            foreground=palette.error,
            wraplength=wraplength,
            justify="left",
            anchor="w",
        )

    def set(self, message: str | None) -> None:
        if message:
            self.label.configure(text=message)
            self.label.pack(anchor="w", pady=(6, 0))
        else:
            self.label.configure(text="")
            self.label.pack_forget()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Tone, StatusPill, EmptyState, InlineError

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ui_kit.py` — `Field`, `Toggle`, `SegmentedControl` (kit-only)

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `Field`, `Toggle`, `SegmentedControl`)

**Interfaces:**
- Consumes: `ui_kit.Palette`, `ui_kit.Fonts`, `ui_kit.tone_color`/`ui_kit.Tone` (Task 4).
- Produces: `ui_kit.Field(parent, *, label, textvariable, palette, fonts, reveal=False, on_change=None)` (exposes `.frame`, `.entry`, `.status`, `.set_status(text, tone)`); `ui_kit.Toggle(parent, *, text, variable, palette, fonts, command=None)` (exposes `.widget`); `ui_kit.SegmentedControl(parent, *, options, palette, fonts, on_change=None)` (exposes `.frame`, `.selected`).

Not wired into `gui.py` this checkpoint — existing Config-tab fields/checkbuttons keep their current ad-hoc implementations (`_build_field`, `_checkbutton`); migrating them is out of scope for a "visual/UX only" checkpoint whose migrations (Tasks 2-3) were chosen specifically for being risk-free 1:1 replacements. `SegmentedControl` has no existing gui.py equivalent to migrate at all — it's new kit surface for the C3 Synchronisation-table filter.

- [ ] **Step 1: Implement all three widgets**

None of these are unit-tested (all construct real Tk widgets — same convention as `ScrollableFrame`/`Card`). Add to `daemon-python/src/ui_kit.py`, after `InlineError`:

```python
class Field:
    """Label + bordered entry + status slot, optionally with a show/hide
    toggle (`reveal=True`, for secrets like the access token). Uses text
    labels ("Afficher"/"Masquer") rather than an eye-icon glyph, per the
    spec's audit finding that emoji-as-icon rendering is version-dependent
    and its Decision to add no new icon pipeline."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        label: str,
        textvariable,
        palette: Palette,
        fonts: Fonts,
        reveal: bool = False,
        on_change=None,
    ) -> None:
        import tkinter as tk
        from tkinter import ttk

        self._palette = palette
        self._revealed = not reveal
        self._show_char = "•" if reveal else ""

        self.frame = ttk.Frame(parent, style="Panel.TFrame")
        ttk.Label(self.frame, text=label, style="Panel.TLabel").pack(anchor="w")

        self._wrapper = tk.Frame(
            self.frame,
            background=palette.field_bg,
            highlightthickness=1,
            highlightbackground=palette.field_bg,
        )
        self._wrapper.pack(fill="x", pady=(4, 0))

        row = tk.Frame(self._wrapper, background=palette.field_bg)
        row.pack(fill="x")

        self.entry = tk.Entry(
            row,
            textvariable=textvariable,
            background=palette.field_bg,
            foreground=palette.text,
            insertbackground=palette.text,
            relief="flat",
            font=fonts.body,
            show=self._show_char if reveal and not self._revealed else "",
        )
        self.entry.pack(side="left", fill="x", expand=True, padx=10, pady=8)
        self.entry.bind(
            "<FocusIn>",
            lambda _e: self._wrapper.configure(
                background=palette.field_bg_focus, highlightbackground=palette.accent
            ),
        )
        self.entry.bind(
            "<FocusOut>",
            lambda _e: self._wrapper.configure(
                background=palette.field_bg, highlightbackground=palette.field_bg
            ),
        )
        if on_change is not None:
            self.entry.bind("<KeyRelease>", lambda _e: on_change())

        if reveal:
            self._reveal_button = tk.Button(
                row,
                text="Afficher",
                command=self._toggle_reveal,
                background=palette.field_bg,
                foreground=palette.text_muted,
                activebackground=palette.field_bg_focus,
                relief="flat",
                borderwidth=0,
                font=fonts.muted,
            )
            self._reveal_button.pack(side="right", padx=(0, 8))

        self.status = ttk.Label(self.frame, text="", style="PanelMuted.TLabel")
        self.status.pack(anchor="w", pady=(4, 0))

    def _toggle_reveal(self) -> None:
        self._revealed = not self._revealed
        self.entry.configure(show="" if self._revealed else self._show_char)
        self._reveal_button.configure(text="Masquer" if self._revealed else "Afficher")

    def set_status(self, text: str, tone: Tone) -> None:
        self.status.configure(text=text, foreground=tone_color(tone, self._palette))


class Toggle:
    """A `Checkbutton` styled to match the dark theme -- consistent with
    `gui.py`'s existing `_checkbutton` look, packaged as a reusable kit
    widget."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        text: str,
        variable,
        palette: Palette,
        fonts: Fonts,
        command=None,
    ) -> None:
        import tkinter as tk

        self.widget = tk.Checkbutton(
            parent,
            text=text,
            variable=variable,
            command=command,
            background=palette.panel,
            foreground=palette.text,
            selectcolor=palette.field_bg,
            activebackground=palette.panel,
            activeforeground=palette.text,
            highlightthickness=0,
            borderwidth=0,
            font=fonts.muted,
            anchor="w",
            wraplength=420,
            justify="left",
        )


class SegmentedControl:
    """A row of mutually-exclusive text options (e.g. filtering the
    Synchronisation table by status) -- plain `tk.Button`s toggled by
    hand rather than `ttk.Radiobutton`, for the same reason `Toggle` uses
    `tk.Checkbutton`: consistent look with this dark theme's cards."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        options,
        palette: Palette,
        fonts: Fonts,
        on_change=None,
    ) -> None:
        import tkinter as tk

        if not options:
            raise ValueError("SegmentedControl needs at least one option")
        self._palette = palette
        self._on_change = on_change
        self._selected = options[0]
        self.frame = tk.Frame(parent, background=palette.field_bg)
        self._buttons: dict[str, tk.Button] = {}
        for option in options:
            button = tk.Button(
                self.frame,
                text=option,
                relief="flat",
                borderwidth=0,
                font=fonts.button,
                command=lambda opt=option: self._select(opt),
            )
            button.pack(side="left", padx=1, pady=1)
            self._buttons[option] = button
        self._repaint()

    def _select(self, option: str) -> None:
        if option == self._selected:
            return
        self._selected = option
        self._repaint()
        if self._on_change is not None:
            self._on_change(option)

    def _repaint(self) -> None:
        for option, button in self._buttons.items():
            selected = option == self._selected
            button.configure(
                background=self._palette.accent if selected else self._palette.field_bg,
                foreground="#0f1220" if selected else self._palette.text_muted,
            )

    @property
    def selected(self) -> str:
        return self._selected
```

- [ ] **Step 2: Manual verification**

Not wired into any window yet — sanity-check by constructing each in a throwaway `python -c` script under a real `tk.Tk()` root (Windows only) to confirm no exceptions on construction; delete the script afterward.

- [ ] **Step 3: Commit**

```bash
git add daemon-python/src/ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Field, Toggle, SegmentedControl (unwired kit widgets)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ui_kit.py` — `Table` (`TableColumn`, `sort_rows`, `filter_rows`, `Table`)

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `TableColumn`, `sort_rows`, `filter_rows`, `Table`)
- Test: `daemon-python/tests/test_ui_kit.py`

**Interfaces:**
- Produces: `ui_kit.TableColumn` (frozen dataclass: `key: str, label: str, width: int = 120, anchor: str = "w"`), `ui_kit.sort_rows(rows, *, key, reverse=False) -> list[dict]`, `ui_kit.filter_rows(rows, *, query, fields) -> list[dict]`, `ui_kit.Table(parent, *, columns, palette, row_tag_colors=None, on_row_context_menu=None)` (exposes `.tree`, `.set_rows(rows, *, tag_fn=None)`).

`sort_rows`/`filter_rows` are the pure, unit-tested pieces (per the spec's Testing section). `Table` itself is real-Tk-only, kit-only this checkpoint — it's the shape the Synchronisation control panel (C3) renders its replay list with, not built by B2.

- [ ] **Step 1: Write the failing tests for `sort_rows`/`filter_rows`**

Add to `daemon-python/tests/test_ui_kit.py`:

```python
def test_sort_rows_ascending_by_key():
    rows = [{"name": "b"}, {"name": "a"}, {"name": "c"}]
    assert [r["name"] for r in ui_kit.sort_rows(rows, key="name")] == ["a", "b", "c"]


def test_sort_rows_reverse():
    rows = [{"name": "a"}, {"name": "c"}, {"name": "b"}]
    assert [r["name"] for r in ui_kit.sort_rows(rows, key="name", reverse=True)] == [
        "c",
        "b",
        "a",
    ]


def test_sort_rows_groups_none_values_first():
    rows = [{"name": "b"}, {"name": None}, {"name": "a"}]
    assert [r["name"] for r in ui_kit.sort_rows(rows, key="name")] == [None, "a", "b"]


def test_filter_rows_case_insensitive_substring_match():
    rows = [{"file": "Replay1.StormReplay"}, {"file": "other.StormReplay"}]
    assert ui_kit.filter_rows(rows, query="replay1", fields=["file"]) == [rows[0]]


def test_filter_rows_empty_query_returns_all_rows_unchanged():
    rows = [{"file": "a"}, {"file": "b"}]
    assert ui_kit.filter_rows(rows, query="", fields=["file"]) == rows


def test_filter_rows_checks_every_given_field():
    rows = [{"file": "a", "account": "Bob"}, {"file": "b", "account": "Alice"}]
    assert ui_kit.filter_rows(rows, query="bob", fields=["file", "account"]) == [rows[0]]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -k "sort_rows or filter_rows" -v`
Expected: FAIL with `AttributeError: module 'src.ui_kit' has no attribute 'sort_rows'`.

- [ ] **Step 3: Implement `TableColumn`, `sort_rows`, `filter_rows`, `Table`**

Add near the top of `daemon-python/src/ui_kit.py` imports: `from typing import Sequence` (or `from collections.abc import Sequence` — match whichever convention the rest of the file's typing imports already use; there are none yet, so use `from collections.abc import Sequence`).

Add to `daemon-python/src/ui_kit.py`, after `SegmentedControl`:

```python
@dataclass(frozen=True)
class TableColumn:
    key: str
    label: str
    width: int = 120
    anchor: str = "w"


def sort_rows(rows: Sequence[dict], *, key: str, reverse: bool = False) -> list[dict]:
    """Stable sort of table rows by column key, with `None` values grouped
    first -- pure so `Table`'s header-click handler is testable without a
    real Treeview widget. Assumes a given column's non-`None` values are
    consistently typed (a replay table's "durée" column is always an int,
    never a mix of int and str)."""
    return sorted(rows, key=lambda row: (row.get(key) is not None, row.get(key)), reverse=reverse)


def filter_rows(rows: Sequence[dict], *, query: str, fields: Sequence[str]) -> list[dict]:
    """Case-insensitive substring filter across `fields` -- pure, same
    reason as `sort_rows`. An empty `query` returns every row unchanged."""
    needle = query.strip().lower()
    if not needle:
        return list(rows)
    return [
        row
        for row in rows
        if any(needle in str(row.get(field, "")).lower() for field in fields)
    ]


class Table:
    """A thin `ttk.Treeview` wrapper: column config, sortable headers,
    row-color tags, and a right-click context-menu hook -- the shape the
    spec's Synchronisation control panel (checkpoint C3) renders its
    replay list with. Not wired into any tab yet. Not unit-tested itself
    (needs a real Tk interpreter); `sort_rows`/`filter_rows` above are
    what's covered."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        columns: Sequence[TableColumn],
        palette: Palette,
        row_tag_colors: dict[str, str] | None = None,
        on_row_context_menu=None,
    ) -> None:
        import tkinter as tk
        from tkinter import ttk

        self._columns = list(columns)
        self._rows: list[dict] = []
        self._sort_key: str | None = None
        self._sort_reverse = False
        self._on_row_context_menu = on_row_context_menu
        self._row_by_iid: dict[str, dict] = {}

        self.tree = ttk.Treeview(
            parent,
            columns=[column.key for column in self._columns],
            show="headings",
            selectmode="browse",
        )
        for column in self._columns:
            self.tree.heading(
                column.key,
                text=column.label,
                command=lambda key=column.key: self._on_header_click(key),
            )
            self.tree.column(column.key, width=column.width, anchor=column.anchor)

        for tag, color in (row_tag_colors or {}).items():
            self.tree.tag_configure(tag, foreground=color)

        self.tree.bind("<Button-3>", self._on_right_click)

    def _on_header_click(self, key: str) -> None:
        self._sort_reverse = (self._sort_key == key) and not self._sort_reverse
        self._sort_key = key
        self.set_rows(self._rows)

    def _on_right_click(self, event) -> None:
        iid = self.tree.identify_row(event.y)
        if not iid or self._on_row_context_menu is None:
            return
        self.tree.selection_set(iid)
        self._on_row_context_menu(event, self._row_by_iid[iid])

    def set_rows(self, rows: Sequence[dict], *, tag_fn=None) -> None:
        self._rows = list(rows)
        ordered = (
            sort_rows(self._rows, key=self._sort_key, reverse=self._sort_reverse)
            if self._sort_key is not None
            else self._rows
        )
        self.tree.delete(*self.tree.get_children())
        self._row_by_iid.clear()
        for index, row in enumerate(ordered):
            iid = str(index)
            tags = (tag_fn(row),) if tag_fn is not None else ()
            self.tree.insert(
                "",
                "end",
                iid=iid,
                values=[row.get(column.key, "") for column in self._columns],
                tags=tags,
            )
            self._row_by_iid[iid] = row
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_ui_kit.py -v`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/ui_kit.py daemon-python/tests/test_ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Table plus pure sort_rows/filter_rows models

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ui_kit.py` — `Banner` (the health strip widget)

**Files:**
- Modify: `daemon-python/src/ui_kit.py` (add `Banner`)

**Interfaces:**
- Consumes: `ui_kit.Tone`, `ui_kit.tone_color`, `ui_kit.Button`, `ui_kit.ButtonVariant`, `ui_kit.DEFAULT_SPACING` (earlier tasks).
- Produces: `ui_kit.Banner(parent, *, palette, fonts)` exposing `.frame` (pack this) and `.set(tone: Tone, message: str, action_label: str | None = None, on_action=None) -> None`. `gui.py`'s health-banner wiring (Task 9) is this widget's only consumer this checkpoint.

- [ ] **Step 1: Implement `Banner`**

Not unit-tested (real Tk construction, same as `Card`). Add to `daemon-python/src/ui_kit.py`, after `Table`:

```python
class Banner:
    """A full-width, tone-colored strip with a message and an optional
    single action button -- the settings window's global health banner
    (see `health.py`'s `HealthSummary`, wired in by `gui.py`). One
    instance is created once and updated in place via `.set(...)` as the
    health state changes, rather than being rebuilt per state."""

    def __init__(self, parent: tk.Misc, *, palette: Palette, fonts: Fonts) -> None:
        import tkinter as tk
        from tkinter import ttk

        self._palette = palette
        self.frame = tk.Frame(parent, background=palette.panel)
        inner = ttk.Frame(self.frame, style="Panel.TFrame", padding=(DEFAULT_SPACING.lg, DEFAULT_SPACING.md))
        inner.pack(fill="x")
        inner.grid_columnconfigure(0, weight=1)

        self._stripe = tk.Frame(self.frame, width=4, background=palette.accent)
        self._stripe.place(x=0, y=0, relheight=1)

        self._message_label = tk.Label(
            inner,
            text="",
            font=fonts.body,
            background=palette.panel,
            foreground=palette.text,
            wraplength=520,
            justify="left",
            anchor="w",
        )
        self._message_label.grid(row=0, column=0, sticky="w")

        self._action_command = None
        self._action_button = ui_kit_button = None  # placeholder replaced below
        self._action_button = Button(
            inner, text="", variant=ButtonVariant.GHOST, command=self._on_action_click
        )
        self._action_button.grid(row=0, column=1, sticky="e", padx=(DEFAULT_SPACING.md, 0))
        self._action_button.grid_remove()

    def _on_action_click(self) -> None:
        if self._action_command is not None:
            self._action_command()

    def set(self, tone: Tone, message: str, action_label: str | None = None, on_action=None) -> None:
        self._stripe.configure(background=tone_color(tone, self._palette))
        self._message_label.configure(text=message)
        if action_label is not None and on_action is not None:
            self._action_command = on_action
            self._action_button.configure(text=action_label)
            self._action_button.grid()
        else:
            self._action_command = None
            self._action_button.grid_remove()
```

Remove the stray `ui_kit_button = None  # placeholder replaced below` line above (leftover from drafting) so the final method reads:

```python
        self._action_command = None
        self._action_button = Button(
            inner, text="", variant=ButtonVariant.GHOST, command=self._on_action_click
        )
        self._action_button.grid(row=0, column=1, sticky="e", padx=(DEFAULT_SPACING.md, 0))
        self._action_button.grid_remove()
```

- [ ] **Step 2: Manual verification**

Deferred to Task 9's manual verification, once `Banner` is actually wired into `gui.py` and visible.

- [ ] **Step 3: Commit**

```bash
git add daemon-python/src/ui_kit.py
git commit -m "$(cat <<'EOF'
feat(daemon): add ui_kit.Banner, the tone-based health-strip widget

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `health.py` — `HealthState`, `HealthSummary`, `compute_health_summary`, `SyncState.last_synced_at()`

**Files:**
- Create: `daemon-python/src/health.py`
- Test: `daemon-python/tests/test_health.py` (new)
- Modify: `daemon-python/src/sync_state.py` (add `last_synced_at`)
- Test: `daemon-python/tests/test_sync_state.py` (add tests for `last_synced_at`)

**Interfaces:**
- Consumes: `daemon_python.src.status.DaemonStatus` (existing: `found: int`, `synced: int`, `failed: int`, `skipped_ai_player: int`, `consecutive_failures: int`, `currently_syncing: frozenset[str]`, `last_error: str | None`).
- Produces: `health.HealthState` (`NOT_CONFIGURED`, `API_UNREACHABLE`, `AUTH_ERROR`, `DEGRADED`, `SYNCING`, `OK`), `health.HealthSummary` (frozen dataclass: `state: HealthState`, `message: str`, `action_label: str | None = None`), `health.compute_health_summary(*, configured, api_reachable, token_valid, daemon_status, failed_count, last_synced_at, now=None) -> HealthSummary`. `SyncState.last_synced_at(self) -> datetime | None`.

- [ ] **Step 1: Write the failing test for `SyncState.last_synced_at()`**

Add to `daemon-python/tests/test_sync_state.py` (matching its existing `SyncState(tmp_path / "sync_state.db")` construction pattern):

```python
def test_last_synced_at_returns_none_when_nothing_synced(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    assert state.last_synced_at() is None


def test_last_synced_at_returns_a_datetime_after_a_sync(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_synced("hash-a", "1.0")
    result = state.last_synced_at()
    assert result is not None


def test_last_synced_at_ignores_skipped_replays_with_no_synced_at(tmp_path):
    state = SyncState(tmp_path / "sync_state.db")
    state.mark_skipped("hash-a", "path/a", "ai_player", "msg", "1.0")
    assert state.last_synced_at() is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_sync_state.py -k last_synced_at -v`
Expected: FAIL with `AttributeError: 'SyncState' object has no attribute 'last_synced_at'`.

- [ ] **Step 3: Implement `SyncState.last_synced_at()`**

In `daemon-python/src/sync_state.py`, add after `get_error_records` (after line 535, before the `# -- debug report` section's next method):

```python
    def last_synced_at(self) -> datetime | None:
        """The most recent `synced_at` across every replay ever marked
        synced -- backs the health banner's "à jour — dernière
        synchronisation il y a X" message (see `health.py`). `None` if
        nothing has ever synced (skipped-only or error-only replays don't
        count -- `synced_at` is only set by `mark_synced`)."""
        with self._lock:
            row = self._conn.execute(
                "SELECT MAX(synced_at) FROM replays WHERE status = 'synced' AND synced_at IS NOT NULL"
            ).fetchone()
        if row is None or row[0] is None:
            return None
        return datetime.fromisoformat(row[0])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_sync_state.py -v`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add daemon-python/src/sync_state.py daemon-python/tests/test_sync_state.py
git commit -m "$(cat <<'EOF'
feat(daemon): add SyncState.last_synced_at()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Write the failing tests for `compute_health_summary`**

Create `daemon-python/tests/test_health.py`:

```python
from datetime import datetime, timezone

from src import health
from src.status import DaemonStatus


def _status(**kwargs) -> DaemonStatus:
    defaults = dict(
        found=0,
        synced=0,
        failed=0,
        skipped_ai_player=0,
        consecutive_failures=0,
        currently_syncing=frozenset(),
        last_error=None,
    )
    defaults.update(kwargs)
    return DaemonStatus(**defaults)


def test_not_configured_takes_priority_over_everything_else():
    summary = health.compute_health_summary(
        configured=False,
        api_reachable=False,
        token_valid=False,
        daemon_status=_status(found=10, failed=5),
        failed_count=5,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.NOT_CONFIGURED
    assert summary.message == "Daemon non configuré — connecte ce PC pour commencer."
    assert summary.action_label == "Connecter ce PC"


def test_api_unreachable():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=False,
        token_valid=None,
        daemon_status=_status(),
        failed_count=0,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.API_UNREACHABLE
    assert summary.action_label is None


def test_auth_error_when_token_explicitly_invalid():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=False,
        daemon_status=_status(),
        failed_count=0,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.AUTH_ERROR
    assert summary.message == "Le token est refusé — reconnecte ce PC."
    assert summary.action_label == "Reconnecter ce PC"


def test_degraded_when_replays_have_failed():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=10, synced=8, failed=2),
        failed_count=2,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.DEGRADED
    assert summary.message == "2 parties n'ont pas pu être synchronisées."
    assert summary.action_label == "Voir le détail"


def test_degraded_singular_wording_for_exactly_one_failure():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=1, failed=1),
        failed_count=1,
        last_synced_at=None,
    )
    assert summary.message == "1 partie n'a pas pu être synchronisée."


def test_syncing_when_replays_remain():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=10, synced=4, failed=0),
        failed_count=0,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.SYNCING
    assert summary.message == "Synchronisation en cours — 6 parties restantes."


def test_syncing_singular_wording_for_exactly_one_remaining():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=1, synced=0, failed=0),
        failed_count=0,
        last_synced_at=None,
    )
    assert summary.message == "Synchronisation en cours — 1 partie restante."


def test_ok_with_no_replays_ever_found():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(),
        failed_count=0,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.OK
    assert summary.message == "À jour — aucune partie à synchroniser pour l'instant."


def test_ok_shows_relative_last_sync_time():
    now = datetime(2026, 9, 20, 12, 0, 0, tzinfo=timezone.utc)
    last_synced = datetime(2026, 9, 20, 11, 55, 0, tzinfo=timezone.utc)
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=3, synced=3),
        failed_count=0,
        last_synced_at=last_synced,
        now=now,
    )
    assert summary.state is health.HealthState.OK
    assert summary.message == "À jour — dernière synchronisation il y a 5 min."


def test_degraded_outranks_syncing():
    summary = health.compute_health_summary(
        configured=True,
        api_reachable=True,
        token_valid=True,
        daemon_status=_status(found=10, synced=3, failed=2),
        failed_count=2,
        last_synced_at=None,
    )
    assert summary.state is health.HealthState.DEGRADED
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd daemon-python && pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.health'`.

- [ ] **Step 8: Implement `health.py`**

Create `daemon-python/src/health.py`:

```python
"""Derives the settings window's single global health signal (the banner
above the notebook, see `gui.py`'s `_refresh_health_banner`) from the
daemon's existing state sources: `StatusTracker`, `SyncState`, config
validity, and the Config tab's connection/token checks.

Kept dependency-free of `gui.py`/tkinter, like `ui_kit.py`, so the state
derivation is unit-testable headless from synthetic inputs (see
`daemon-python/tests/test_health.py`) instead of only being verifiable by
hand in a real window.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from .status import DaemonStatus


class HealthState(str, Enum):
    NOT_CONFIGURED = "not_configured"
    API_UNREACHABLE = "api_unreachable"
    AUTH_ERROR = "auth_error"
    DEGRADED = "degraded"
    SYNCING = "syncing"
    OK = "ok"


@dataclass(frozen=True)
class HealthSummary:
    """One rendering of the health banner: what to say, and (for states
    that have one) the label of the single action button the banner shows.
    `gui.py` owns turning `action_label` into an actual click handler (see
    `_SettingsWindow._on_health_action`) -- this module only decides
    *that* an action exists and what it should be called."""

    state: HealthState
    message: str
    action_label: str | None = None


def _format_time_ago(moment: datetime, now: datetime) -> str:
    """Same phrasing as `gui.py`'s `_format_time_ago` (kept as a separate,
    `now`-injectable copy here so this module stays headless-testable and
    free of any `gui.py` import -- see the module docstring)."""
    seconds = int((now - moment).total_seconds())
    if seconds < 60:
        return f"il y a {max(seconds, 0)}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"il y a {minutes} min"
    hours = minutes // 60
    return f"il y a {hours} h"


def compute_health_summary(
    *,
    configured: bool,
    api_reachable: bool | None,
    token_valid: bool | None,
    daemon_status: DaemonStatus,
    failed_count: int,
    last_synced_at: datetime | None,
    now: datetime | None = None,
) -> HealthSummary:
    """Pure derivation of the banner's state, in priority order (highest
    first): not configured, API unreachable, auth error, degraded (some
    replays failed), syncing (some remain), idle/OK.

    `api_reachable`/`token_valid` are `None` until the Config tab's
    debounced connection check (`gui.py`'s `_check_connection_worker`) has
    run at least once. `failed_count` is the persisted count from
    `SyncState.get_error_records()`, not `daemon_status.failed` (this
    run's count only) -- a failure from a previous run must still show as
    degraded after a restart, not silently reset to healthy.
    """
    if not configured:
        return HealthSummary(
            state=HealthState.NOT_CONFIGURED,
            message="Daemon non configuré — connecte ce PC pour commencer.",
            action_label="Connecter ce PC",
        )
    if api_reachable is False:
        return HealthSummary(
            state=HealthState.API_UNREACHABLE,
            message="L'API est injoignable — nouvelle tentative sous peu.",
        )
    if token_valid is False:
        return HealthSummary(
            state=HealthState.AUTH_ERROR,
            message="Le token est refusé — reconnecte ce PC.",
            action_label="Reconnecter ce PC",
        )
    if failed_count > 0:
        message = (
            "1 partie n'a pas pu être synchronisée."
            if failed_count == 1
            else f"{failed_count} parties n'ont pas pu être synchronisées."
        )
        return HealthSummary(
            state=HealthState.DEGRADED, message=message, action_label="Voir le détail"
        )
    remaining = max(0, daemon_status.found - daemon_status.synced - daemon_status.failed)
    if remaining > 0:
        message = (
            "Synchronisation en cours — 1 partie restante."
            if remaining == 1
            else f"Synchronisation en cours — {remaining} parties restantes."
        )
        return HealthSummary(state=HealthState.SYNCING, message=message)
    if last_synced_at is None:
        return HealthSummary(
            state=HealthState.OK,
            message="À jour — aucune partie à synchroniser pour l'instant.",
        )
    moment = now if now is not None else datetime.now(timezone.utc)
    return HealthSummary(
        state=HealthState.OK,
        message=f"À jour — dernière synchronisation {_format_time_ago(last_synced_at, moment)}.",
    )
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd daemon-python && pytest tests/test_health.py -v`
Expected: PASS (all 11 tests).

- [ ] **Step 10: Commit**

```bash
git add daemon-python/src/health.py daemon-python/tests/test_health.py
git commit -m "$(cat <<'EOF'
feat(daemon): add health.py with compute_health_summary and its states

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `gui.py` — wire the health banner above the notebook

**Files:**
- Modify: `daemon-python/src/gui.py` (imports, `_SettingsWindow.__init__`, `_build_ui`, `_apply_api_status`, `_apply_token_status`, `_set_tab_problem` area, new methods)

**Interfaces:**
- Consumes: `ui_kit.Banner`, `ui_kit.Tone` (Task 7); `health.HealthState`, `health.HealthSummary`, `health.compute_health_summary` (Task 8); `SyncState.last_synced_at()` (Task 8); `status.DaemonStatus` (existing).
- Produces: `_SettingsWindow._refresh_health_banner()`, `_SettingsWindow._on_health_action()`, `_SettingsWindow._select_tab(key: str)`.

- [ ] **Step 1: Add imports and the tone-mapping constant**

In `daemon-python/src/gui.py`, change:

```python
from .status import StatusTracker
```

to:

```python
from . import health
from .status import DaemonStatus, StatusTracker
```

Add near the other module-level constants (with `_LIVE_STATS_POLL_MS` etc.):

```python
_HEALTH_STATE_TONES: dict[health.HealthState, ui_kit.Tone] = {
    health.HealthState.NOT_CONFIGURED: ui_kit.Tone.NEUTRAL,
    health.HealthState.API_UNREACHABLE: ui_kit.Tone.ERROR,
    health.HealthState.AUTH_ERROR: ui_kit.Tone.ERROR,
    health.HealthState.DEGRADED: ui_kit.Tone.WARN,
    health.HealthState.SYNCING: ui_kit.Tone.INFO,
    health.HealthState.OK: ui_kit.Tone.OK,
}
_HEALTH_BANNER_POLL_MS = 5_000
```

- [ ] **Step 2: Track API/token reachability as instance state**

In `_SettingsWindow.__init__` (`gui.py`), add alongside the other `self._...` initializations (after `self._tabs: dict[...] = {}`):

```python
        # Set by `_apply_api_status`/`_apply_token_status` once the Config
        # tab's connection check has run at least once; `None` until then
        # (see `health.compute_health_summary`'s docstring for why `None`
        # is a distinct state from `False`).
        self._api_reachable: bool | None = None
        self._token_valid: bool | None = None
        self._health_banner_job: str | None = None
```

- [ ] **Step 3: Build the banner in `_build_ui`, between the subtitle and the notebook**

In `_build_ui` (`gui.py`), change:

```python
        ttk.Label(outer, text=subtitle, style="Muted.TLabel").pack(
            anchor="w", pady=(2, 14)
        )

        notebook = ttk.Notebook(outer)
```

to:

```python
        ttk.Label(outer, text=subtitle, style="Muted.TLabel").pack(
            anchor="w", pady=(2, 14)
        )

        self._health_banner = ui_kit.Banner(
            outer, palette=ui_kit.DEFAULT_PALETTE, fonts=self._fonts
        )
        self._health_banner.frame.pack(fill="x", pady=(0, 14))

        notebook = ttk.Notebook(outer)
```

- [ ] **Step 4: Compute and apply the health summary, and reschedule itself**

Add these three methods to `_SettingsWindow`, near `_refresh_live_stats` (`gui.py`):

```python
    def _refresh_health_banner(self) -> None:
        daemon_status = (
            self._status_tracker.snapshot() if self._status_tracker is not None else DaemonStatus(
                found=0,
                synced=0,
                failed=0,
                skipped_ai_player=0,
                consecutive_failures=0,
                currently_syncing=frozenset(),
                last_error=None,
            )
        )
        failed_count = (
            len(self._sync_state.get_error_records()) if self._sync_state is not None else 0
        )
        last_synced_at = (
            self._sync_state.last_synced_at() if self._sync_state is not None else None
        )
        summary = health.compute_health_summary(
            configured=not self._is_first_run,
            api_reachable=self._api_reachable,
            token_valid=self._token_valid,
            daemon_status=daemon_status,
            failed_count=failed_count,
            last_synced_at=last_synced_at,
        )
        tone = _HEALTH_STATE_TONES[summary.state]
        self._health_banner.set(
            tone,
            summary.message,
            action_label=summary.action_label,
            on_action=(
                (lambda: self._on_health_action(summary.state))
                if summary.action_label is not None
                else None
            ),
        )
        self._health_banner_job = self._root.after(
            _HEALTH_BANNER_POLL_MS, self._refresh_health_banner
        )

    def _on_health_action(self, state: "health.HealthState") -> None:
        if state in (health.HealthState.NOT_CONFIGURED, health.HealthState.AUTH_ERROR):
            self._select_tab("config")
            self._api_entry.focus_set()
        elif state is health.HealthState.DEGRADED:
            self._select_tab("sync")

    def _select_tab(self, key: str) -> None:
        notebook, tab, _title = self._tabs[key]
        notebook.select(tab)
```

- [ ] **Step 5: Start the refresh loop, and hook connection-check results into it**

In `_SettingsWindow.__init__` (`gui.py`), change:

```python
        self._check_connection()
        if not is_first_run:
```

to:

```python
        self._check_connection()
        self._refresh_health_banner()
        if not is_first_run:
```

In `_apply_api_status` (`gui.py`), change:

```python
    def _apply_api_status(self, reachable: bool) -> None:
        if reachable:
            self._set_status(self._api_status, "✓ Connexion OK", _OK)
        else:
            self._set_status(self._api_status, "✗ Injoignable", _ERROR)
```

to:

```python
    def _apply_api_status(self, reachable: bool) -> None:
        self._api_reachable = reachable
        if reachable:
            self._set_status(self._api_status, "✓ Connexion OK", _OK)
        else:
            self._set_status(self._api_status, "✗ Injoignable", _ERROR)
        self._refresh_health_banner()
```

In `_apply_token_status` (`gui.py`), change:

```python
    def _apply_token_status(self, state: dict | str) -> None:
        if state == "unknown":
            self._set_status(self._token_status, "", _NEUTRAL)
        elif state == "invalid":
            self._set_status(self._token_status, "✗ Token invalide", _ERROR)
        else:
            self._set_status(self._token_status, "✓ Token valide", _OK)
            if hasattr(self, "_games_count_label"):
                self._games_count_label.configure(
                    text=str(state.get("gamesPlayed", "—"))
                )
```

to:

```python
    def _apply_token_status(self, state: dict | str) -> None:
        if state == "unknown":
            self._token_valid = None
            self._set_status(self._token_status, "", _NEUTRAL)
        elif state == "invalid":
            self._token_valid = False
            self._set_status(self._token_status, "✗ Token invalide", _ERROR)
        else:
            self._token_valid = True
            self._set_status(self._token_status, "✓ Token valide", _OK)
            if hasattr(self, "_games_count_label"):
                self._games_count_label.configure(
                    text=str(state.get("gamesPlayed", "—"))
                )
        self._refresh_health_banner()
```

Note: `_refresh_health_banner` reschedules itself every `_HEALTH_BANNER_POLL_MS` (Step 4), so these two extra calls from `_apply_api_status`/`_apply_token_status` are immediate, event-driven refreshes on top of that steady poll — not a second competing loop. Because `_refresh_health_banner` unconditionally calls `self._root.after(...)` again each time it runs, an event-driven call from `_apply_api_status` schedules one *additional* future tick; this is harmless (the next few ticks just repaint the same state) and avoids threading a "cancel the pending job" path through `_after_if_open`'s already-established close-guard contract.

- [ ] **Step 6: Cancel the banner's poll job on close**

Find where `_live_stats_job`/other `self._root.after(...)` jobs are cancelled in `_on_close` (`gui.py`) and add `_health_banner_job` to that same cleanup, following whatever existing pattern is used there (e.g. `if self._X_job is not None: self._root.after_cancel(self._X_job)`).

- [ ] **Step 7: Manual verification**

Reopen the settings window in each of these states and confirm the banner shows the right French copy, tone color, and (where applicable) action button, and that clicking an action button switches to the right tab:
1. First run (no config saved yet) → grey "Daemon non configuré…" banner with "Connecter ce PC".
2. A valid API URL entered but no/blank token → after the debounce, banner should NOT show auth-error (token check is skipped when there's no token — `_check_connection_worker` sends `"unknown"`), so it should read as syncing/OK based on daemon status.
3. Wrong API URL (unreachable) → red "L'API est injoignable…" banner, no action button.
4. Valid API URL + wrong token → red "Le token est refusé…" banner with "Reconnecter ce PC"; clicking it switches to the Config tab.
5. Valid config, some replays failed (check via the Debug window / `SyncState`) → amber "N parties n'ont pas pu être synchronisées." with "Voir le détail"; clicking it switches to the Synchronisation tab.
6. Valid config, everything synced → green "À jour — dernière synchronisation il y a X." with no action button.
7. Close and reopen the window; confirm the banner's polling job doesn't error or leak (no exceptions in the console after closing).

- [ ] **Step 8: Commit**

```bash
git add daemon-python/src/gui.py
git commit -m "$(cat <<'EOF'
feat(daemon): wire the global health banner into the settings window

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Manual verification (required — no automated coverage end-to-end)

This checkpoint has no subagent-executable acceptance test beyond the unit tests already run per-task — the widget kit and health banner only fully prove themselves in a real Windows session. A human must verify, on Windows, at a minimum:

- [ ] Every migrated card/section-header/button in the Config, Draft Live, Synchronisation, and Update tabs (and the Debug/manual-download sub-windows) looks pixel-identical to before this checkpoint.
- [ ] The health banner's 6 states (not configured, API unreachable, auth error, degraded, syncing, OK) each render with correct French copy, tone color, and action button per Task 9 Step 7's checklist.
- [ ] The health banner's action buttons correctly switch tabs and focus the right field.
- [ ] DPI scaling (100%/125%/150%, per B1's Task 11) still looks correct with the new banner and migrated widgets in place.
- [ ] No console exceptions on open, tab-switch, resize, or close, with the health banner's new polling job running.
- [ ] `daemon-python`'s full test suite passes: `cd daemon-python && pytest -q`.

---

## Self-Review

**1. Spec coverage:**
- Widget kit tokens (Spacing) → Task 1. Containers (Card, SectionHeader) → Task 2. Actions (Button variants) → Task 3. Feedback (StatusPill, EmptyState, InlineError) → Task 4; (Banner) → Task 7. Inputs (Field, Toggle, SegmentedControl) → Task 5. Table → Task 6. Global health banner + its 5 documented states plus the Error-handling section's "API unreachable" distinction (6th state) → Task 8 + Task 9. Accessibility (4.5:1 contrast, no color-only status) → Task 1's contrast tests + Task 4's `status_pill_text` glyph-prefix test. Testing section (pure logic unit-tested, widget construction manual) → every task's Steps follow this split explicitly. Roadmap's "visual/UX only" scope (no Sync panel data/actions, no wizard, no tray.py) → called out in Global Constraints and in Tasks 5/6's "kit-only, not wired" notes.
- No gap found.

**2. Placeholder scan:** No "TBD"/"TODO"/"similar to Task N" found. One drafting artifact was caught and corrected in Task 7 Step 1 (a stray `ui_kit_button = None  # placeholder replaced below` line), with the corrected final code shown immediately after.

**3. Type consistency:** `ui_kit.Palette` gains `warn` in Task 1 and every later task that constructs `Palette`/uses `DEFAULT_PALETTE` (Tasks 2-9) references only fields defined there. `ui_kit.Tone` (Task 4) is the sole tone vocabulary used by both `StatusPill` (Task 4) and `Banner` (Task 7) — no duplicate `BannerTone` enum was introduced. `ui_kit.ButtonVariant`/`button_style`/`Button` (Task 3) are the only button API used by `Banner` (Task 7) and `EmptyState` (Task 4, via the literal `"Accent.TButton"` style string — kept as a literal there since `EmptyState` predates `Button` in file order only nominally; both resolve to the same style name, verified no mismatch). `health.HealthState`/`HealthSummary`/`compute_health_summary`'s signature (Task 8) matches exactly what `gui.py`'s `_refresh_health_banner` calls in Task 9 (`configured`, `api_reachable`, `token_valid`, `daemon_status`, `failed_count`, `last_synced_at` — all keyword args, matching). `SyncState.last_synced_at()` (Task 8) matches its call site in Task 9's `_refresh_health_banner`.
