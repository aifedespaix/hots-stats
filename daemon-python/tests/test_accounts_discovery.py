from pathlib import Path

from src.accounts_discovery import discover_account_folders, watch_dirs


def _make_account(root: Path, account_id: str, toon: str, queues=("Multiplayer",)) -> Path:
    replays = root / "Accounts" / account_id / toon / "Replays"
    for queue in queues:
        (replays / queue).mkdir(parents=True, exist_ok=True)
    return replays


def test_discovers_every_account_folder(tmp_path):
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240")
    _make_account(tmp_path, "1112776579", "2-Hero-1-13560393")

    folders = discover_account_folders(tmp_path)

    assert [f.toon_handle for f in folders] == ["2-Hero-1-13560393", "2-Hero-1-4929240"]
    assert folders[0].account_id == "1112776579"


def test_ignores_non_toon_folders(tmp_path):
    (tmp_path / "Accounts" / "415612224" / "Hotkeys").mkdir(parents=True)
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240")

    assert len(discover_account_folders(tmp_path)) == 1


def test_missing_accounts_root_is_empty(tmp_path):
    assert discover_account_folders(tmp_path) == []


def test_watch_dirs_covers_every_queue_and_keeps_toon(tmp_path):
    _make_account(tmp_path, "415612224", "2-Hero-1-4929240", queues=("Multiplayer", "Custom"))

    dirs = watch_dirs(tmp_path)

    assert {(d.path.name, d.toon_handle) for d in dirs} == {
        ("Multiplayer", "2-Hero-1-4929240"),
        ("Custom", "2-Hero-1-4929240"),
    }


def test_watch_dirs_appends_extra_dirs_without_toon(tmp_path):
    extra = tmp_path / "elsewhere" / "Replays" / "Multiplayer"
    extra.mkdir(parents=True)

    dirs = watch_dirs(tmp_path, [extra])

    assert [d.path for d in dirs] == [extra]
    assert dirs[0].toon_handle is None


def test_watch_dirs_dedupes_a_repeated_extra(tmp_path):
    extra = tmp_path / "elsewhere"
    extra.mkdir(parents=True)

    dirs = watch_dirs(tmp_path, [extra, extra])

    assert [d.path for d in dirs] == [extra]
