"""Regenerates the daemon's icon assets from the web app's favicon.

Run this after `apps/web/public/favicon.svg` changes, from the repo root:

    pip install cairosvg pillow
    python daemon-python/assets/generate_icons.py

It writes:
- daemon-python/assets/app-icon.ico -- the .exe's file icon (Nuitka's
  --windows-icon-from-ico in .github/workflows/build-daemon.yml).
- daemon-python/src/_icon_data.py -- the system tray icon, embedded as a
  base64 PNG constant (not a bundled data file, so it survives Nuitka's
  --onefile packaging without needing a runtime extraction-path lookup).
  Composited onto a small dark backdrop disc -- gui.py's `_BG` -- so it
  stays legible on both light and dark taskbars.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import cairosvg
from PIL import Image

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FAVICON_SVG = _REPO_ROOT / "apps" / "web" / "public" / "favicon.svg"
_ICO_OUT = Path(__file__).resolve().parent / "app-icon.ico"
_TRAY_MODULE_OUT = _REPO_ROOT / "daemon-python" / "src" / "_icon_data.py"

_TRAY_ICON_SIZE = 64
_TRAY_BACKDROP = (28, 31, 46, 255)  # matches gui.py's _BG panel color


def main() -> None:
    png_bytes = cairosvg.svg2png(url=str(_FAVICON_SVG), output_width=256, output_height=256)
    glyph = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    glyph.save(
        _ICO_OUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {_ICO_OUT}")

    canvas = Image.new("RGBA", (_TRAY_ICON_SIZE, _TRAY_ICON_SIZE), (0, 0, 0, 0))
    from PIL import ImageDraw

    margin = 2
    ImageDraw.Draw(canvas).ellipse(
        (margin, margin, _TRAY_ICON_SIZE - margin, _TRAY_ICON_SIZE - margin), fill=_TRAY_BACKDROP
    )
    glyph_size = int(_TRAY_ICON_SIZE * 0.72)
    resized_glyph = glyph.resize((glyph_size, glyph_size), Image.LANCZOS)
    offset = ((_TRAY_ICON_SIZE - glyph_size) // 2, (_TRAY_ICON_SIZE - glyph_size) // 2)
    canvas.alpha_composite(resized_glyph, offset)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    wrapped_lines = [b64[i : i + 96] for i in range(0, len(b64), 96)]
    wrapped = "\n    ".join(f'"{line}"' for line in wrapped_lines)

    _TRAY_MODULE_OUT.write_text(
        '"""Base64-encoded tray icon PNG, generated from apps/web/public/favicon.svg\n'
        "(the same mark used by the web app) composited onto a small dark backdrop\n"
        "disc for legibility on any taskbar theme. Regenerate with\n"
        "daemon-python/assets/generate_icons.py after the favicon changes.\n\n"
        "Embedded directly rather than shipped as a separate data file so it survives\n"
        "Nuitka's --onefile packaging without needing --include-data-files and a\n"
        "runtime extraction-path lookup.\n"
        '"""\n\n'
        "from __future__ import annotations\n\n"
        "TRAY_ICON_PNG_BASE64 = (\n"
        f"    {wrapped}\n"
        ")\n",
        encoding="utf-8",
    )
    print(f"wrote {_TRAY_MODULE_OUT}")


if __name__ == "__main__":
    main()
