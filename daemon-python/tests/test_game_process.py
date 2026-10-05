import sys

import pytest

from src.game_process import GameDetector, _list_process_names


def test_detects_the_game_case_insensitively():
    detector = GameDetector(lister=lambda: ["explorer.exe", "HeroesOfTheStorm_x64.exe"])
    assert detector.is_running() is True


def test_other_processes_do_not_count():
    assert GameDetector(lister=lambda: ["chrome.exe", "HeroesLauncher.exe"]).is_running() is False


def test_result_is_cached_for_the_ttl_then_refreshed():
    calls: list[int] = []
    now = {"t": 0.0}

    def lister() -> list[str]:
        calls.append(1)
        return ["HeroesOfTheStorm_x64.exe"] if len(calls) == 1 else []

    detector = GameDetector(lister=lister, ttl=5.0, clock=lambda: now["t"])
    assert detector.is_running() is True
    now["t"] = 4.0
    assert detector.is_running() is True and len(calls) == 1
    now["t"] = 5.0
    assert detector.is_running() is False and len(calls) == 2


def test_a_failing_lister_means_not_running():
    def boom() -> list[str]:
        raise OSError("snapshot failed")

    assert GameDetector(lister=boom).is_running() is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows process snapshot")
def test_real_process_listing_returns_names_including_this_interpreter():
    names = [n.lower() for n in _list_process_names()]
    assert any(n.startswith("python") for n in names)
