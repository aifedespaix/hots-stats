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
    card = win._activity_card
    assert card is not None
    assert card._title.cget("text").upper() == "ACTIVITÉ EN COURS"
    pause = win._sync_table._pause_button
    assert pause.master is card.header_actions


def test_stat_tiles_reflow_as_the_window_narrows(window):
    win, top = window
    top.geometry("900x600")
    top.update()
    assert win._tile_cols == 3
    # The window's minimum width is 640 (see `_center`), so 1 column is only
    # reachable via `recap_columns` (tested in test_sync_layout); here we
    # check the reflow down to the narrowest the window can get.
    top.geometry("640x600")
    top.update()
    assert win._tile_cols == 2


from src.onboarding import View


def test_only_the_startup_token_check_can_open_the_wizard(window):
    win, _top = window
    win._startup_check_pending = False
    win._show_view(View.MAIN)
    win._apply_token_status("invalid")  # user typing a partial token in Config
    assert win._current_view is View.MAIN

    win._startup_check_pending = True
    win._apply_token_status("invalid")  # the check made when the window opened
    assert win._current_view is View.WIZARD_CONNECT
    assert win._onboarding is not None


def test_an_unreachable_api_at_startup_keeps_the_main_view(window):
    win, _top = window
    win._startup_check_pending = True
    win._apply_token_status("unknown")
    assert win._current_view is View.MAIN
    assert win._startup_check_pending is False


def test_window_without_a_stored_token_opens_on_the_connect_step(tk_root, tmp_path):
    existing = {"apiBaseUrl": "https://api.example.com", "accessToken": "", "hotsDir": str(tmp_path)}
    (tmp_path / "Accounts").mkdir()
    top = tk.Toplevel(tk_root)
    top.attributes("-alpha", 0.0)
    with (
        mock.patch.object(gui, "read_config_file", return_value=existing),
        mock.patch.object(gui.api_client, "ping_health", return_value=False),
        mock.patch.object(gui.autostart, "is_supported", return_value=False),
        mock.patch.object(gui.updater, "IS_FROZEN", False),
    ):
        win = gui._SettingsWindow(top, is_first_run=False, result={"saved": False})
        top.update()
        assert win._current_view is View.WIZARD_CONNECT
        win._stop_background_jobs()
    top.destroy()


def test_finishing_the_wizard_notifies_the_app_then_closes_the_window(window):
    win, _top = window
    win._on_reconnected = mock.Mock()
    win._on_close = mock.Mock()
    win._finish_onboarding()  # the saved config equals the form, so nothing is written
    win._on_reconnected.assert_called_once_with()
    win._on_close.assert_called_once_with()


def test_sign_out_stops_the_watcher_clears_the_token_and_shows_the_connect_step(window):
    win, _top = window
    win._on_logout = mock.Mock()
    with (
        mock.patch.object(gui.messagebox, "askyesno", return_value=True),
        mock.patch.object(gui, "clear_access_token") as cleared,
    ):
        win._sign_out()
    win._on_logout.assert_called_once_with()
    cleared.assert_called_once_with()
    assert win._token_var.get() == ""
    assert win._current_view is View.WIZARD_CONNECT


def test_sign_out_does_nothing_when_the_user_declines(window):
    win, _top = window
    win._on_logout = mock.Mock()
    with (
        mock.patch.object(gui.messagebox, "askyesno", return_value=False),
        mock.patch.object(gui, "clear_access_token") as cleared,
    ):
        win._sign_out()
    win._on_logout.assert_not_called()
    cleared.assert_not_called()
    assert win._token_var.get() == "hots_pat_x"


def test_sign_out_button_is_disabled_without_a_token(window):
    win, _top = window
    assert not win._signout_button.instate(["disabled"])
    win._token_var.set("")
    assert win._signout_button.instate(["disabled"])


def test_closing_is_only_blocked_when_there_is_nothing_valid_to_keep(window):
    win, _top = window
    assert win._close_blocked_by(None) is False
    win._last_saved = None  # nothing valid saved yet...
    win._token_var.set("")  # ...and signed out, reopened from the tray
    assert win._close_blocked_by("Le token d'accès est requis.") is False
    win._require_login = True  # the startup window must not close unconnected
    assert win._close_blocked_by("Le token d'accès est requis.") is True
    win._require_login = False
    win._token_var.set("hots_pat_x")  # a token but an invalid config (e.g. bad folder)
    assert win._close_blocked_by("Le dossier Heroes of the Storm est invalide.") is True
