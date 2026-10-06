import tkinter as tk

import pytest


@pytest.fixture(scope="session")
def tk_root():
    """One Tk root for the whole run: creating/destroying several roots in a row
    is flaky on Windows and silently skips tests."""
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    from src import gui

    gui._apply_dark_style()
    yield root
    root.destroy()
