import tkinter as tk
from unittest import mock

import pytest

from src import gui
from src.status import StatusTracker


# `tk_root` (session-scoped, invisible but mapped) comes from tests/conftest.py.


class _FakeState:
    def __init__(self):
        self.meta: dict[str, str] = {}

    def all_rows(self):
        return []

    def get_meta(self, key):
        return self.meta.get(key)

    def set_meta(self, key, value):
        self.meta[key] = value


@pytest.fixture
def window(tk_root, tmp_path):
    (tmp_path / "Accounts" / "1" / "2-Hero-1-1" / "Replays" / "Multiplayer").mkdir(parents=True)
    existing = {"apiBaseUrl": "https://api.example.com", "accessToken": "hots_pat_x", "hotsDir": str(tmp_path)}
    top = tk.Toplevel(tk_root)
    top.attributes("-alpha", 0.0)
    with (
        mock.patch.object(gui, "read_config_file", return_value=existing),
        # Nothing here may touch the real config file / %APPDATA%.
        mock.patch.object(gui, "save_config"),
        mock.patch.object(gui, "open_config_folder"),
        mock.patch.object(gui.api_client, "ping_health", return_value=False),
        mock.patch.object(gui.api_client, "fetch_summary", return_value=None),
        mock.patch.object(gui.api_client, "fetch_version", return_value=None),
        mock.patch.object(gui.autostart, "is_supported", return_value=False),
        mock.patch.object(gui.updater, "IS_FROZEN", False),
    ):
        win = gui._SettingsWindow(
            top,
            is_first_run=False,
            result={"saved": False},
            status_tracker=StatusTracker(),
            sync_state=_FakeState(),
        )
        top.update()
        yield win, top
        win._stop_background_jobs()
    top.destroy()


def test_tabs_are_sync_then_draft_then_config(window):
    win, _top = window
    assert list(win._tabs) == ["sync", "draft_live", "config"]


def test_footer_has_icon_only_buttons_with_tooltips_and_the_right_emphasis(window):
    win, _top = window
    assert {"data_folder", "site"} <= set(win._footer_tooltips)
    assert all(tip.text for tip in win._footer_tooltips.values())
    for key in win._footer_tooltips:
        assert str(win._footer_buttons[key].cget("style")) == "Icon.Secondary.Ghost.TButton"
        assert win._footer_buttons[key].cget("text") in ("🐞", "📁", "🌐")
    assert str(win._minimize_button.cget("style")) == "Primary.TButton"
    assert "Réduire" in win._minimize_button.cget("text")
    assert str(win._close_button.cget("style")) == "Danger.Ghost.TButton"


def test_site_button_opens_the_dashboard(window):
    win, _top = window
    with mock.patch.object(gui.webbrowser, "open") as opened:
        win._open_site()
    opened.assert_called_once_with("https://app.example.com")


def test_footer_and_tab_bar_stay_visible_when_the_window_is_small(window):
    win, top = window
    top.geometry("640x480")
    top.update()
    bottom = top.winfo_rooty() + top.winfo_height()
    assert win._footer.winfo_ismapped()
    assert win._footer.winfo_rooty() + win._footer.winfo_height() <= bottom
    assert win._notebook._bar.winfo_ismapped()
    assert win._notebook._bar.winfo_rooty() - top.winfo_rooty() <= 20  # small top margin


def test_progress_bar_never_overflows_a_narrow_window(window):
    win, top = window
    top.geometry("560x520")
    top.update()
    right_edge = top.winfo_rootx() + top.winfo_width()
    bar = win._sync_progress_bar
    assert bar.winfo_rootx() + bar.winfo_width() <= right_edge


def test_activity_panel_is_a_collapsible_card_titled_activite_en_cours(window):
    win, _top = window
    assert win._activity_card is not None
