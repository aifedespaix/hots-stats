"""Base64-encoded tray/window icon PNGs, generated from
apps/web/public/favicon.svg (the same mark used by the web app), on a
transparent background. `LIGHT` has deeper stops for light taskbars and
panels, `DARK` brighter ones for dark ones. Regenerate with
daemon-python/assets/generate_icons.py after the favicon changes.

Embedded directly rather than shipped as separate data files so they survive
Nuitka's --onefile packaging without needing --include-data-files and a
runtime extraction-path lookup.
"""

from __future__ import annotations

TRAY_ICON_LIGHT_PNG_BASE64 = (
    "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"
)

TRAY_ICON_DARK_PNG_BASE64 = (
    "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"
    "QmCC"
)
