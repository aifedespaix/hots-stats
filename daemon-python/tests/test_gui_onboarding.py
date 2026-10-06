import threading
import time
import tkinter as tk
from pathlib import Path

import pytest

from src import gui
from src.auth_flow import AuthorizationResult
from src.gui_onboarding import OnboardingHooks, OnboardingView
from src.onboarding import Step, View


@pytest.fixture(scope="module")
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Tk cannot create a root window here")
    root.attributes("-alpha", 0.0)  # invisible but mapped: a withdrawn root never maps its children
    gui._apply_dark_style()
    yield root
    root.destroy()


class _Env:
    """Drives the view with fake hooks. `schedule` queues instead of running,
    because worker threads must never touch Tk: tests pump from the Tk thread."""

    def __init__(self, root, view, *, auth_result=None, verify_ok=True, autostart=False):
        self.root = root
        self.pending: list = []
        self.stored: list[str] = []
        self.finished = 0
        self.opened_token_page = 0
        self.verified: list[str] = []
        self.replays_var = tk.StringVar(master=root, value="")
        self.autostart_var = tk.BooleanVar(master=root, value=False) if autostart else None
        self.auth_result = auth_result or AuthorizationResult(token="hots_pat_ok")

        def verify(token):
            self.verified.append(token)
            return verify_ok

        hooks = OnboardingHooks(
            authorize=lambda cancel: self.auth_result,
            verify_token=verify,
            open_token_page=lambda: setattr(self, "opened_token_page", self.opened_token_page + 1),
            schedule=lambda fn, *a: self.pending.append((fn, a)),
            browse_dir=lambda: None,
            on_autostart_toggled=lambda: None,
            store_token=self.stored.append,
            finish=lambda: setattr(self, "finished", self.finished + 1),
        )
        self.frame = tk.Frame(root)
        self.frame.pack()
        self.view = OnboardingView(
            self.frame,
            view=view,
            replays_var=self.replays_var,
            autostart_var=self.autostart_var,
            hooks=hooks,
            version="9.9.9",
        )
        self.view.pack()
        self.view.start(animate=False)
        root.update()

    def pump(self, until, timeout=3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.root.update()
            while self.pending:
                fn, args = self.pending.pop(0)
                fn(*args)
            if until():
                return
            time.sleep(0.01)
        raise AssertionError("condition not reached in time")

    def close(self):
        self.view.destroy()
        self.frame.destroy()


def _hots_root(tmp_path: Path) -> Path:
    (tmp_path / "Accounts" / "1" / "2-Hero-1-1" / "Replays" / "Multiplayer").mkdir(parents=True)
    return tmp_path


def test_successful_browser_auth_stores_the_token_and_moves_to_storage(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    assert env.view.flow.step is Step.CONNECT
    env.view._start_connect()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    assert env.stored == ["hots_pat_ok"]
    env.close()


def test_failed_auth_shows_the_error_and_offers_the_manual_fallback(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL, auth_result=AuthorizationResult(error="Délai dépassé. Réessaie la connexion."))
    env.view._start_connect()
    env.pump(lambda: env.view._manual_link.winfo_ismapped())
    assert "Délai dépassé" in env.view._status.cget("text")
    assert env.stored == []
    env.close()


def test_manual_token_is_rejected_locally_without_a_network_call(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._toggle_manual()
    env.view._paste_var.set("pas un token")
    env.view._validate_manual()
    assert env.verified == []
    assert "hots_pat_" in env.view._status.cget("text")
    env.close()


def test_manual_token_is_verified_then_stored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._toggle_manual()
    env.view._paste_var.set('  "hots_pat_abc"\n')
    env.view._validate_manual()
    env.pump(lambda: env.stored == ["hots_pat_abc"])
    assert env.verified == ["hots_pat_abc"]
    env.close()


def test_manual_token_refused_by_the_server_is_not_stored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL, verify_ok=False)
    env.view._toggle_manual()
    env.view._paste_var.set("hots_pat_abc")
    env.view._validate_manual()
    env.pump(lambda: "refusé" in env.view._status.cget("text"))
    assert env.stored == []
    env.close()


def test_connect_only_view_finishes_after_a_successful_connection(tk_root):
    env = _Env(tk_root, View.WIZARD_CONNECT)
    env.view._start_connect()
    env.pump(lambda: env.finished == 1)
    env.close()


def test_storage_step_blocks_continue_until_the_folder_is_valid(tk_root, tmp_path):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._render(Step.STORAGE)
    tk_root.update()
    assert env.view._continue_button.instate(["disabled"])
    env.replays_var.set(str(_hots_root(tmp_path)))
    tk_root.update()
    assert not env.view._continue_button.instate(["disabled"])
    env.close()


def test_a_late_auth_result_after_the_view_is_destroyed_is_dropped(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._start_connect()
    env.view.destroy()
    for fn, args in env.pending or []:
        fn(*args)  # must not raise
    env.pump(lambda: True)
    env.frame.destroy()


def test_ready_step_finishes_the_wizard(tk_root, tmp_path):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.replays_var.set(str(_hots_root(tmp_path)))
    env.view._render(Step.READY)
    env.view._finish_button.invoke()
    assert env.finished == 1
    env.close()
