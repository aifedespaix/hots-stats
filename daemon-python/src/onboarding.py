"""Pure logic behind the first-run / reconnect wizard (no tkinter), so it is
unit-tested directly. The Tk side lives in gui_onboarding.py."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from .accounts_discovery import discover_account_folders

# Mirrors TOKEN_PREFIX in apps/api/src/lib/tokens.ts.
TOKEN_PREFIX = "hots_pat_"


class Step(Enum):
    CONNECT = 1
    STORAGE = 2
    READY = 3


STEP_LABELS = {Step.CONNECT: "Connexion", Step.STORAGE: "Stockage", Step.READY: "C'est prêt"}


class View(Enum):
    WIZARD_FULL = "wizard_full"
    WIZARD_CONNECT = "wizard_connect"
    MAIN = "main"


def initial_view(*, is_first_run: bool, token: str) -> View:
    """First run -> the 3-step wizard. Later, no stored token -> connect step
    only. Otherwise the classic window (an invalid stored token is caught by
    the startup check, see `view_after_token_check`)."""
    if is_first_run:
        return View.WIZARD_FULL
    if not token.strip():
        return View.WIZARD_CONNECT
    return View.MAIN


def view_after_token_check(current: View, token_state: str) -> View:
    """Only a *rejected* token on the classic window flips to the wizard: an
    unreachable API ("unknown") must not lock the user out of their window."""
    if current is View.MAIN and token_state == "invalid":
        return View.WIZARD_CONNECT
    return current


def normalize_pasted_token(text: str) -> str | None:
    """The token as a user would paste it (maybe with spaces, a newline or
    quotes around it), or None when it can't be one."""
    cleaned = text.strip().strip("\"'`").strip()
    if not cleaned or any(ch.isspace() for ch in cleaned):
        return None
    if not cleaned.startswith(TOKEN_PREFIX):
        return None
    return cleaned


class WizardFlow:
    def __init__(self, view: View) -> None:
        self._full = view is View.WIZARD_FULL
        self.step = Step.CONNECT

    @property
    def steps(self) -> list[Step]:
        return list(Step) if self._full else [Step.CONNECT]

    def advance(self) -> Step | None:
        """Moves to the next step; None when the current one was the last."""
        steps = self.steps
        index = steps.index(self.step)
        if index + 1 >= len(steps):
            return None
        self.step = steps[index + 1]
        return self.step

    def back(self) -> Step:
        steps = self.steps
        index = steps.index(self.step)
        if index > 0:
            self.step = steps[index - 1]
        return self.step


@dataclass(frozen=True)
class DirCheck:
    ok: bool
    status: str  # short inline status next to the field
    summary: str  # multi-line "accounts found" text ("" when none)


def describe_replays_dir(value: str) -> DirCheck:
    """What the HotS-root field should say about `value`. Must be the HotS
    *root*, not one account's Replays folder: everything is discovered under
    Accounts/<id>/<toon>/Replays from here."""
    value = value.strip()
    if not value:
        return DirCheck(False, "Sélectionnez un dossier", "")
    root = Path(value)
    if not root.is_dir():
        return DirCheck(False, "✗ Introuvable", "")
    accounts = discover_account_folders(root)
    if accounts:
        summary = "\n".join(
            f"• {folder.toon_handle} — "
            f"{sum(1 for _ in folder.replays_dir.rglob('*.StormReplay'))} replay(s)"
            for folder in accounts
        )
        return DirCheck(True, f"✓ {len(accounts)} compte(s) détecté(s)", summary)
    if (root / "Accounts").is_dir():
        return DirCheck(True, "✓ Dossier trouvé (aucun compte)", "Aucun compte détecté sous Accounts/.")
    return DirCheck(False, "✗ Pas un dossier Heroes of the Storm", "")
