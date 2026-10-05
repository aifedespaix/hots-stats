import logging
import re
from pathlib import Path

from src import constants
from src.error_reporter import (
    ErrorReporter,
    ReportingHandler,
    make_fingerprint,
    scrub_paths,
)
from src.sync_state import SyncState


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _reporter(sent: list, *, ok=lambda: True, state=None, clock=None, **kwargs) -> ErrorReporter:
    def send(report: dict) -> bool:
        sent.append(report)
        return ok()

    return ErrorReporter(send, state, clock=clock or FakeClock(), **kwargs)


def test_scrub_paths_replaces_the_windows_user_directory():
    text = r"File C:\Users\clape\AppData\Roaming\x.py, line 3"
    assert scrub_paths(text) == r"File ~\AppData\Roaming\x.py, line 3"


def test_scrub_paths_handles_user_names_containing_spaces():
    assert scrub_paths(r"bad C:\Users\John Smith\x.StormReplay") == r"bad ~\x.StormReplay"
    assert scrub_paths(r"open 'C:\Users\bob' failed") == "open '~' failed"


def test_fingerprint_ignores_digits_but_not_type_or_replay():
    a = make_fingerprint("runtime", "failed after 3 tries", None)
    assert a == make_fingerprint("runtime", "failed after 9 tries", None)
    assert a != make_fingerprint("server", "failed after 3 tries", None)
    assert a != make_fingerprint("runtime", "failed after 3 tries", "h" * 64)


def test_identical_reports_are_sent_once_with_an_occurrence_count():
    sent: list = []
    reporter = _reporter(sent)
    for _ in range(3):
        reporter.report("runtime", "watcher crashed")
    assert reporter.flush() == 1
    assert sent[0]["occurrences"] == 3
    assert sent[0]["errorType"] == "runtime"


def test_report_carries_every_version_and_a_scrubbed_message():
    sent: list = []
    reporter = _reporter(sent)
    reporter.report("parse", r"bad file C:\Users\bob\x.StormReplay", replay_hash="a" * 64, base_build=96477)
    reporter.flush()
    report = sent[0]
    assert report["parserVersion"] == constants.PARSER_VERSION
    assert report["daemonVersion"] == constants.APP_VERSION
    assert report["heroprotocolVersion"] == constants.HEROPROTOCOL_VERSION
    assert report["baseBuild"] == 96477
    assert "bob" not in report["errorMessage"]
    assert report["fingerprint"]


def test_a_flood_of_distinct_failures_is_capped_at_thirty_per_minute():
    sent: list = []
    clock = FakeClock()
    reporter = _reporter(sent, clock=clock)
    for i in range(3000):
        reporter.report("validation", "rejected", replay_hash=f"{i:064x}")
    for _ in range(60):
        reporter.flush()
        clock.advance(1.0)
    assert len(sent) == 30


def test_two_flushes_in_the_same_second_send_only_one_report():
    sent: list = []
    reporter = _reporter(sent)
    reporter.report("runtime", "one")
    reporter.report("runtime", "two")
    reporter.flush()
    reporter.flush()
    assert len(sent) == 1


def test_failed_send_is_queued_offline_and_delivered_once_the_api_is_back(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    sent: list = []
    api_up = {"value": False}
    clock = FakeClock()
    reporter = _reporter(sent, ok=lambda: api_up["value"], state=state, clock=clock)
    reporter.report("runtime", "while offline")
    assert reporter.flush() == 0
    assert len(state.peek_error_reports(10)) == 1

    api_up["value"] = True
    clock.advance(2.0)
    assert reporter.flush() == 1
    assert state.peek_error_reports(10) == []
    assert sent[-1]["errorMessage"] == "while offline"


def test_failed_send_without_a_state_db_is_retried_from_memory():
    sent: list = []
    api_up = {"value": False}
    clock = FakeClock()
    reporter = _reporter(sent, ok=lambda: api_up["value"], clock=clock)
    reporter.report("runtime", "kept in memory")
    reporter.flush()
    api_up["value"] = True
    clock.advance(2.0)
    assert reporter.flush() == 1


def test_offline_queue_is_capped_at_500_oldest_dropped(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    for i in range(520):
        state.enqueue_error_report(f"fp{i}", f'{{"n": {i}}}')
    rows = state.peek_error_reports(1000)
    assert len(rows) == 500
    assert rows[0][1] == '{"n": 20}'


def test_logging_handler_reports_warnings_and_skips_info_and_excluded_loggers():
    sent: list = []
    reporter = _reporter(sent)
    handler = ReportingHandler(reporter)
    log = logging.getLogger("hotsq.watcher")
    log.setLevel(logging.DEBUG)
    log.addHandler(handler)
    ingestion_log = logging.getLogger("hotsq.ingestion")
    ingestion_log.addHandler(handler)
    try:
        log.info("fine")
        log.warning("watcher died: %s", "disk gone")
        ingestion_log.error("already reported by ingest_file")
    finally:
        log.removeHandler(handler)
        ingestion_log.removeHandler(handler)
    clock = reporter._clock
    reporter.flush()
    clock.advance(2.0)
    reporter.flush()
    clock.advance(2.0)
    reporter.flush()
    assert len(sent) == 1
    assert sent[0]["errorType"] == "runtime"
    assert "disk gone" in sent[0]["errorMessage"]


def test_a_log_line_emitted_while_sending_does_not_create_a_new_report():
    log = logging.getLogger("hotsq.reentrant")
    sent: list = []

    def send(report: dict) -> bool:
        sent.append(report)
        log.warning("noise from inside the send path")
        return True

    clock = FakeClock()
    reporter = ErrorReporter(send, None, clock=clock)
    handler = ReportingHandler(reporter)
    log.addHandler(handler)
    try:
        reporter.report("runtime", "first")
        reporter.flush()
        clock.advance(2.0)
        reporter.flush()
    finally:
        log.removeHandler(handler)
    assert len(sent) == 1


def test_heroprotocol_constant_matches_the_pin_in_pyproject():
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r"heroprotocol @ git\+https://[^@\s\"]+@v([\d.]+)", text)
    assert match is not None
    assert constants.HEROPROTOCOL_VERSION == match.group(1)


def test_persist_pending_moves_reports_to_the_queue_and_a_later_reporter_delivers_them(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    reporter = _reporter([], state=state)
    for i in range(3):
        reporter.report("runtime", f"problem-{chr(97 + i)}")
    assert reporter.persist_pending() == 3
    assert reporter.persist_pending() == 0
    assert len(state.peek_error_reports(10)) == 3

    sent: list = []
    clock = FakeClock()
    later = _reporter(sent, state=state, clock=clock)
    for _ in range(3):
        later.flush()
        clock.advance(2.0)
    assert len(sent) == 3
    assert state.peek_error_reports(10) == []


def test_persist_pending_without_a_state_db_is_a_no_op():
    reporter = _reporter([])
    reporter.report("runtime", "x")
    assert reporter.persist_pending() == 0


def test_flush_drops_a_corrupt_queued_row_and_continues(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    state.enqueue_error_report("bad", "{not json")
    sent: list = []
    reporter = _reporter(sent, state=state)
    reporter.report("runtime", "good")
    assert reporter.flush() == 1
    assert state.peek_error_reports(10) == []
    assert sent[0]["errorMessage"] == "good"


def test_flush_never_raises_and_keeps_the_report_when_send_raises(tmp_path: Path):
    state = SyncState(tmp_path / "s.db")
    boom = {"on": True}
    sent: list = []

    def send(report: dict) -> bool:
        if boom["on"]:
            raise RuntimeError("network exploded")
        sent.append(report)
        return True

    clock = FakeClock()
    reporter = ErrorReporter(send, state, clock=clock)
    reporter.report("runtime", "keep me")
    assert reporter.flush() == 0
    assert len(state.peek_error_reports(10)) == 1
    boom["on"] = False
    clock.advance(2.0)
    assert reporter.flush() == 1
    assert sent[0]["errorMessage"] == "keep me"
