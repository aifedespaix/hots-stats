import threading
from pathlib import Path

from src.ingestion import IngestOutcome
from src.upload_scheduler import MODE_AUTO, MODE_PAUSED, UploadScheduler


def _p(name: str) -> Path:
    return Path(f"C:/r/{name}.StormReplay")


class Harness:
    def __init__(self, **kwargs) -> None:
        self.ingested: list[Path] = []
        self.waits: list[float] = []
        self.outcomes: dict[Path, IngestOutcome] = {}
        self.game = False
        self.auth_blocked = 0
        self.idle = 0

        def ingest(path: Path, _toon: str | None) -> IngestOutcome:
            self.ingested.append(path)
            return self.outcomes.get(path, IngestOutcome("uploaded"))

        defaults = dict(
            stop_event=threading.Event(),
            is_game_running=lambda: self.game,
            on_idle=lambda: setattr(self, "idle", self.idle + 1),
            on_auth_blocked=lambda: setattr(self, "auth_blocked", self.auth_blocked + 1),
            wait=self.waits.append,
            poll_seconds=0,
        )
        defaults.update(kwargs)
        self.scheduler = UploadScheduler(ingest, **defaults)

    def drain(self, limit: int = 50) -> None:
        for _ in range(limit):
            if not self.scheduler.step():
                return


def test_new_replays_go_before_the_backlog():
    h = Harness()
    h.scheduler.enqueue_backlog([(_p("old1"), None), (_p("old2"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh", "old1", "old2"]


def test_backlog_files_are_followed_by_a_pause_but_new_ones_are_not():
    h = Harness(backlog_pause=1.0)
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert h.waits == [1.0]


def test_backlog_pause_is_skipped_after_a_cheap_skip_but_not_after_an_upload():
    h = Harness(backlog_pause=1.0)
    h.outcomes[_p("synced")] = IngestOutcome("skipped", "already synced")
    h.outcomes[_p("budget")] = IngestOutcome("skipped", "parse retry budget exhausted")
    h.scheduler.enqueue_backlog([(_p("synced"), None), (_p("budget"), None), (_p("up"), None)])
    h.drain()
    assert h.waits == [1.0]  # only the upload


def test_backlog_pause_still_applies_after_an_ai_player_skip():
    h = Harness(backlog_pause=1.0)
    h.outcomes[_p("ai")] = IngestOutcome("skipped", "ai", skip_reason="ai_player")
    h.scheduler.enqueue_backlog([(_p("ai"), None)])
    h.drain()
    assert h.waits == [1.0]


def test_backlog_waits_while_the_game_runs_but_new_replays_still_upload():
    h = Harness()
    h.game = True
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh"]
    assert h.scheduler.snapshot().blocked == "game"
    h.game = False
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh", "old"]


def test_paused_mode_blocks_the_backlog_even_without_the_game():
    h = Harness()
    h.scheduler.set_mode(MODE_PAUSED)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert h.ingested == []
    assert h.scheduler.snapshot().blocked == "paused"
    h.scheduler.set_mode(MODE_AUTO)
    h.drain()
    assert len(h.ingested) == 1


def test_sync_during_game_setting_overrides_the_game_check():
    h = Harness(sync_during_game=lambda: True)
    h.game = True
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.drain()
    assert len(h.ingested) == 1


def test_backlog_gate_blocks_the_backlog_only():
    h = Harness(backlog_gate=lambda: False)
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    h.scheduler.enqueue_new(_p("fresh"), None)
    h.drain()
    assert [p.stem.split(".")[0] for p in h.ingested] == ["fresh"]
    assert h.scheduler.snapshot().blocked == "dependency"


def test_auth_error_stops_everything_and_notifies_once():
    h = Harness()
    h.outcomes[_p("a")] = IngestOutcome("error", "token rejected", error_kind="auth")
    h.scheduler.enqueue_backlog([(_p("a"), None), (_p("b"), None), (_p("c"), None)])
    h.drain()
    assert len(h.ingested) == 1
    assert h.auth_blocked == 1
    assert h.scheduler.snapshot().blocked == "auth"
    h.scheduler.enqueue_new(_p("d"), None)
    h.drain()
    assert len(h.ingested) == 1


def test_server_errors_back_off_exponentially_and_requeue_at_most_twice():
    h = Harness(backoff_base=2.0, backoff_max=300.0, max_requeues=2)
    h.outcomes[_p("flaky")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("flaky"), None)
    h.drain()
    assert len(h.ingested) == 3  # first try + 2 re-queues
    assert h.waits == [2.0, 4.0, 8.0]


def test_a_success_resets_the_backoff():
    h = Harness(backoff_base=2.0)
    h.outcomes[_p("flaky")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("flaky"), None)
    h.scheduler.step()
    h.outcomes.pop(_p("flaky"))
    h.drain()
    h.outcomes[_p("later")] = IngestOutcome("error", "502", error_kind="server")
    h.scheduler.enqueue_new(_p("later"), None)
    h.scheduler.step()
    assert h.waits[-1] == 2.0


def test_snapshot_reports_queued_files_as_pending_and_clears_them_when_done():
    h = Harness()
    h.scheduler.enqueue_backlog([(_p("old"), None)])
    assert h.scheduler.snapshot().live == {str(_p("old")): "pending"}
    h.drain()
    assert h.scheduler.snapshot().live == {}


def test_idle_ticks_call_on_idle():
    h = Harness()
    assert h.scheduler.step() is False
    assert h.idle == 1
