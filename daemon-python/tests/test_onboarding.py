from pathlib import Path

from src.onboarding import (
    Step,
    View,
    WizardFlow,
    describe_replays_dir,
    initial_view,
    normalize_pasted_token,
    view_after_token_check,
)


def test_first_run_always_gets_the_full_wizard():
    assert initial_view(is_first_run=True, token="") is View.WIZARD_FULL
    assert initial_view(is_first_run=True, token="hots_pat_x") is View.WIZARD_FULL


def test_reopened_window_without_a_token_gets_the_connect_step_only():
    assert initial_view(is_first_run=False, token="") is View.WIZARD_CONNECT
    assert initial_view(is_first_run=False, token="   ") is View.WIZARD_CONNECT


def test_reopened_window_with_a_token_shows_the_main_view():
    assert initial_view(is_first_run=False, token="hots_pat_x") is View.MAIN


def test_invalid_token_at_startup_switches_to_the_connect_step():
    assert view_after_token_check(View.MAIN, "invalid") is View.WIZARD_CONNECT


def test_unreachable_api_or_valid_token_never_shows_the_wizard():
    assert view_after_token_check(View.MAIN, "unknown") is View.MAIN
    assert view_after_token_check(View.MAIN, "valid") is View.MAIN


def test_token_check_never_changes_a_wizard_that_is_already_showing():
    assert view_after_token_check(View.WIZARD_FULL, "invalid") is View.WIZARD_FULL


def test_pasted_token_is_trimmed_and_unquoted():
    assert normalize_pasted_token("  hots_pat_abc123\n") == "hots_pat_abc123"
    assert normalize_pasted_token('"hots_pat_abc123"') == "hots_pat_abc123"


def test_pasted_token_rejects_empty_inner_whitespace_and_wrong_prefix():
    assert normalize_pasted_token("") is None
    assert normalize_pasted_token("   ") is None
    assert normalize_pasted_token("hots_pat_abc 123") is None
    assert normalize_pasted_token("abc123") is None


def test_full_flow_walks_the_three_steps_then_finishes():
    flow = WizardFlow(View.WIZARD_FULL)
    assert flow.step is Step.CONNECT
    assert flow.advance() is Step.STORAGE
    assert flow.advance() is Step.READY
    assert flow.advance() is None
    assert flow.back() is Step.STORAGE
    assert flow.back() is Step.CONNECT
    assert flow.back() is Step.CONNECT


def test_connect_only_flow_finishes_after_the_first_step():
    flow = WizardFlow(View.WIZARD_CONNECT)
    assert flow.steps == [Step.CONNECT]
    assert flow.advance() is None


def _make_account(root: Path) -> None:
    (root / "Accounts" / "415612224" / "2-Hero-1-4929240" / "Replays" / "Multiplayer").mkdir(parents=True)


def test_describe_dir_blank_and_missing():
    assert describe_replays_dir("  ").ok is False
    assert describe_replays_dir("  ").status == "Sélectionnez un dossier"
    missing = describe_replays_dir(str(Path("/definitely/not/here")))
    assert missing.ok is False and missing.status == "✗ Introuvable"


def test_describe_dir_with_accounts(tmp_path):
    _make_account(tmp_path)
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is True
    assert check.status == "✓ 1 compte(s) détecté(s)"
    assert "2-Hero-1-4929240" in check.summary and "0 replay(s)" in check.summary


def test_describe_dir_accounts_folder_without_toon(tmp_path):
    (tmp_path / "Accounts").mkdir()
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is True and check.status == "✓ Dossier trouvé (aucun compte)"


def test_describe_dir_that_is_not_a_hots_folder(tmp_path):
    check = describe_replays_dir(str(tmp_path))
    assert check.ok is False and check.status == "✗ Pas un dossier Heroes of the Storm"
