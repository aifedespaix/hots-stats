import threading
import time
import tkinter as tk
from pathlib import Path

import pytest

from src.auth_flow import AuthorizationResult
from src.gui_onboarding import OnboardingHooks, OnboardingView
from src.onboarding import Step, View


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
        self.auth_calls = 0

        def _authorize(cancel):
            self.auth_calls += 1
            return self.auth_result

        self._authorize = _authorize

        def verify(token):
            self.verified.append(token)
            return verify_ok

        hooks = OnboardingHooks(
            authorize=self._authorize,
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
    deadline = time.monotonic() + 3.0
    while not env.pending and time.monotonic() < deadline:
        tk_root.update()
        time.sleep(0.01)
    assert env.pending, "the worker never queued its result"
    env.view.destroy()
    for fn, args in env.pending:
        fn(*args)  # must not raise
    assert env.stored == []
    assert env.finished == 0
    env.frame.destroy()


def test_a_second_submit_during_the_connected_pause_is_ignored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._start_connect()
    env.pump(lambda: env.stored == ["hots_pat_ok"])
    env.view._start_connect()
    env.view._start_connect()
    env.view._paste_var.set("hots_pat_other")
    env.view._validate_manual()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    for _ in range(10):
        tk_root.update()
        while env.pending:
            fn, args = env.pending.pop(0)
            fn(*args)
        time.sleep(0.01)
    assert env.stored == ["hots_pat_ok"]
    assert env.verified == []
    assert env.view.flow.step is Step.STORAGE
    assert env.finished == 0
    env.close()


def test_a_second_manual_validation_during_the_connected_pause_is_ignored(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._toggle_manual()
    env.view._paste_var.set("hots_pat_abc")
    env.view._validate_manual()
    env.pump(lambda: env.stored == ["hots_pat_abc"])
    env.view._validate_manual()
    env.view._start_connect()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    for _ in range(10):
        tk_root.update()
        while env.pending:
            fn, args = env.pending.pop(0)
            fn(*args)
        time.sleep(0.01)
    assert env.stored == ["hots_pat_abc"]
    assert env.verified == ["hots_pat_abc"]
    assert env.view.flow.step is Step.STORAGE
    assert env.finished == 0
    env.close()


def test_back_from_storage_lets_the_user_reauthorize(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._start_connect()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    assert env.auth_calls == 1
    env.view._back()
    tk_root.update()
    assert env.view.flow.step is Step.CONNECT
    assert not env.view._connect_button.instate(["disabled"])
    env.view._start_connect()
    env.pump(lambda: env.auth_calls == 2)
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    assert env.stored == ["hots_pat_ok", "hots_pat_ok"]
    env.close()


def test_back_from_storage_lets_the_user_validate_a_manual_token_again(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.view._start_connect()
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    env.view._back()
    tk_root.update()
    env.view._toggle_manual()
    env.view._paste_var.set("hots_pat_abc")
    env.view._validate_manual()
    env.pump(lambda: env.verified == ["hots_pat_abc"])
    env.pump(lambda: env.view.flow.step is Step.STORAGE)
    assert env.stored[-1] == "hots_pat_abc"
    env.close()


def test_waiting_for_the_browser_animates_the_button_and_restores_it_on_failure(tk_root):
    env = _Env(tk_root, View.WIZARD_FULL, auth_result=AuthorizationResult(error="Échec"))
    original = env.view._connect_button.cget("text")
    env.view._start_connect()
    assert "Connexion" in env.view._connect_button.cget("text")
    frames = {env.view._connect_button.cget("text")}
    deadline = time.monotonic() + 0.5
    while time.monotonic() < deadline and len(frames) < 2 and not env.pending:
        tk_root.update()
        frames.add(env.view._connect_button.cget("text"))
        time.sleep(0.01)
    env.pump(lambda: env.view._manual_link.winfo_ismapped())
    assert env.view._connect_button.cget("text") == original
    assert not env.view._connect_button.instate(["disabled"])
    env.close()


def test_ready_step_finishes_the_wizard(tk_root, tmp_path):
    env = _Env(tk_root, View.WIZARD_FULL)
    env.replays_var.set(str(_hots_root(tmp_path)))
    env.view._render(Step.READY)
    env.view._finish_button.invoke()
    assert env.finished == 1
    env.close()
