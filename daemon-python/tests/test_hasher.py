import hashlib
from pathlib import Path

from src.hasher import hash_replay_file


def test_hash_matches_manual_sha256(tmp_path: Path) -> None:
    content = b"some replay bytes" * 1000
    path = tmp_path / "a.StormReplay"
    path.write_bytes(content)

    assert hash_replay_file(path) == hashlib.sha256(content).hexdigest()


def test_hash_stable_across_calls(tmp_path: Path) -> None:
    path = tmp_path / "a.StormReplay"
    path.write_bytes(b"identical content")

    assert hash_replay_file(path) == hash_replay_file(path)


def test_hash_differs_for_different_content(tmp_path: Path) -> None:
    path_a = tmp_path / "a.StormReplay"
    path_b = tmp_path / "b.StormReplay"
    path_a.write_bytes(b"content a")
    path_b.write_bytes(b"content b")

    assert hash_replay_file(path_a) != hash_replay_file(path_b)
