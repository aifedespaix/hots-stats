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
"""

from __future__ import annotations

import sys

from src.main import main

if __name__ == "__main__":
    sys.exit(main())
