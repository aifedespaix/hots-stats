"""Regenerates the daemon's icon assets from the web app's favicon.

Run this after `apps/web/public/favicon.svg` changes, from the repo root:

    pip install resvg-py pillow
    python daemon-python/assets/generate_icons.py

All outputs are transparent (no backdrop); only the gradient stops differ:
- daemon-python/assets/app-icon.ico -- the .exe's file icon (Nuitka's
  --windows-icon-from-ico in .github/workflows/build-daemon.yml). A file icon
  can't follow the OS theme, so it uses a "universal" palette whose stops
  keep >= 3:1 contrast on both white and a dark taskbar (checked below).
- daemon-python/src/_icon_data.py -- the tray/window icons, embedded as
  base64 PNG constants (not bundled data files, so they survive Nuitka's
  --onefile packaging without needing a runtime extraction-path lookup):
  a LIGHT variant (deeper stops, for light taskbars/panels) and a DARK
  variant (brighter stops, for dark taskbars/panels) -- the same two palettes
  as the favicon's `prefers-color-scheme` media query.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path

import resvg_py
from PIL import Image

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FAVICON_SVG = _REPO_ROOT / "apps" / "web" / "public" / "favicon.svg"
_ICO_OUT = Path(__file__).resolve().parent / "app-icon.ico"
_TRAY_MODULE_OUT = _REPO_ROOT / "daemon-python" / "src" / "_icon_data.py"

_TRAY_ICON_SIZE = 64
_RENDER_SIZE = 256

# (stop-a, stop-b, stop-c). LIGHT/DARK mirror the favicon.svg <style> block.
_PALETTE_LIGHT = ("#0086c7", "#4300cc", "#7a00cc")
_PALETTE_DARK = ("#00aeff", "#5500ff", "#9d00ff")
_PALETTE_UNIVERSAL = ("#0a95e0", "#7a4cf5", "#a03be8")

# Backgrounds the universal palette must stay legible on (WCAG graphics: 3:1).
_UNIVERSAL_BACKGROUNDS = ("#ffffff", "#202020")
_MIN_CONTRAST = 3.0


def _luminance(hex_color: str) -> float:
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    hi, lo = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def _render(palette: tuple[str, str, str], size: int) -> Image.Image:
    """Renders the favicon with explicit gradient stops. resvg doesn't run
    the SVG's `prefers-color-scheme` media query, so the <style> block is
    replaced by per-stop `stop-color` attributes."""
    svg = _FAVICON_SVG.read_text(encoding="utf-8")
    svg = re.sub(r"<style>.*?</style>", "", svg, flags=re.DOTALL)
    for name, color in zip(("a", "b", "c"), palette):
        svg = svg.replace(f'class="stop-{name}"', f'stop-color="{color}"')
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def _check_universal_contrast() -> None:
    for color in _PALETTE_UNIVERSAL:
        for background in _UNIVERSAL_BACKGROUNDS:
            ratio = _contrast(color, background)
            assert ratio >= _MIN_CONTRAST, f"{color} on {background}: {ratio:.2f}:1"


def _embed(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    wrapped = "\n    ".join(f'"{b64[i : i + 96]}"' for i in range(0, len(b64), 96))
    return f"(\n    {wrapped}\n)"


def main() -> None:
    _check_universal_contrast()

    _render(_PALETTE_UNIVERSAL, _RENDER_SIZE).save(
        _ICO_OUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {_ICO_OUT}")

    light = _embed(_render(_PALETTE_LIGHT, _TRAY_ICON_SIZE))
    dark = _embed(_render(_PALETTE_DARK, _TRAY_ICON_SIZE))

    _TRAY_MODULE_OUT.write_text(
        '"""Base64-encoded tray/window icon PNGs, generated from\n'
        "apps/web/public/favicon.svg (the same mark used by the web app), on a\n"
        "transparent background. `LIGHT` has deeper stops for light taskbars and\n"
        "panels, `DARK` brighter ones for dark ones. Regenerate with\n"
        "daemon-python/assets/generate_icons.py after the favicon changes.\n\n"
        "Embedded directly rather than shipped as separate data files so they survive\n"
        "Nuitka's --onefile packaging without needing --include-data-files and a\n"
        "runtime extraction-path lookup.\n"
        '"""\n\n'
        "from __future__ import annotations\n\n"
        f"TRAY_ICON_LIGHT_PNG_BASE64 = {light}\n\n"
        f"TRAY_ICON_DARK_PNG_BASE64 = {dark}\n",
        encoding="utf-8",
    )
    print(f"wrote {_TRAY_MODULE_OUT}")


if __name__ == "__main__":
    main()
