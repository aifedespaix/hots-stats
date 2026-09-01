"""Top-level launcher used only for the compiled (Nuitka) build.

Nuitka compiles whichever file you point it at as the `__main__` module, with
no parent package — so if that file itself does `from . import api_client`
(as `src/main.py` does), the relative import has nothing to resolve against
and fails at runtime with:

    ImportError: attempted relative import with no known parent package

Pointing Nuitka at *this* file instead fixes it: this script lives outside
the `src` package and does a normal `from src.main import main`, so Python
(and Nuitka, which mirrors CPython's import semantics) loads `src` as a real
package first. That gives `src.main` proper package context, so its internal
relative imports resolve normally. `src/main.py` itself is untouched and
keeps working as before for local dev (`python -m src.main`).

`velopack.App().run()` runs first, before `src.main` (and anything it
imports) is even imported -- Velopack's own contract requires this: it
handles special lifecycle invocations (first-run-after-install, post-update,
uninstall) that its installer/updater launches this exe with, and it may
itself exit the process after handling one of those instead of returning.
Only this compiled-build entry point needs it: `python -m src.main` (local
dev) never goes through a Velopack-managed install, so there's nothing for
the hook to do there and no reason to add it to `src/main.py` too.
"""

from __future__ import annotations

import sys

import velopack

if __name__ == "__main__":
    velopack.App().run()

    from src.main import main

    sys.exit(main())
