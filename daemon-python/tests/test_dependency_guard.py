from src.dependency_guard import DependencyGuard


def test_not_blocked_until_the_api_announces_a_higher_minimum():
    guard = DependencyGuard("2.55.15.96477")
    assert guard.blocked is False
    assert guard.update(None) is False
    assert guard.update("2.55.15.96477") is False
    assert guard.blocked is False


def test_a_higher_minimum_blocks_and_reports_the_transition_once():
    guard = DependencyGuard("2.55.15.96477")
    assert guard.update("2.55.16.100000") is True
    assert guard.blocked is True and guard.required == "2.55.16.100000"
    assert guard.update("2.55.16.100000") is False  # already blocked: no second report


def test_versions_compare_numerically_not_as_strings():
    guard = DependencyGuard("2.55.9.1")
    assert guard.update("2.55.15.1") is True


def test_unblocks_when_the_requirement_drops_or_the_daemon_is_updated():
    guard = DependencyGuard("2.55.15.96477")
    guard.update("2.55.16.100000")
    assert guard.update("2.55.15.96477") is False
    assert guard.blocked is False
