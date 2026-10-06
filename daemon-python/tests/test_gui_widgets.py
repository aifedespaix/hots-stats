import tkinter as tk
from tkinter import ttk

import pytest

from src.gui_widgets import CollapsibleCard, Tooltip


@pytest.fixture(scope="module")
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    yield root
    root.destroy()


def test_header_actions_sit_in_the_header_and_do_not_toggle_the_card(tk_root):
    card = CollapsibleCard(tk_root, "ACTIVITÉ", "📋")
    card.pack()
    button = ttk.Button(card.header_actions, text="Pause")
    button.pack(side="right")
    tk_root.update()

    assert card.header_actions.winfo_ismapped()
    assert button.winfo_ismapped()
    button.event_generate("<Button-1>")
    tk_root.update()
    assert card.expanded is True
    card.destroy()


def test_tooltip_shows_on_demand_and_hides_on_leave(tk_root):
    button = ttk.Button(tk_root, text="i")
    button.pack()
    tk_root.update()
    tip = Tooltip(button, "Ouvrir le site")
    assert tip.visible is False
    tip.show()
    tk_root.update()
    assert tip.visible is True
    button.event_generate("<Leave>")
    tk_root.update()
    assert tip.visible is False
    button.destroy()


def test_tooltip_hides_on_click_and_when_its_widget_is_destroyed(tk_root):
    button = ttk.Button(tk_root, text="i")
    button.pack()
    tk_root.update()
    tip = Tooltip(button, "x")
    tip.show()
    button.event_generate("<ButtonPress-1>")
    tk_root.update()
    assert tip.visible is False
    tip.show()
    button.destroy()
    tk_root.update()
    assert tip.visible is False
