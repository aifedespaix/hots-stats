from unittest.mock import MagicMock, patch

import pytest
import requests

from src.api_client import ApiClient, ApiClientError, AuthError, ValidationError, fetch_summary, ping_health
from src.config import Config


def _config(tmp_path) -> Config:
    return Config(api_base_url="https://api.example.com", access_token="hots_pat_abc", replays_dir=tmp_path)


def _response(status_code: int, json_body: dict) -> MagicMock:
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.json.return_value = json_body
    resp.raise_for_status.return_value = None
    return resp


def test_post_replay_success(tmp_path):
    client = ApiClient(_config(tmp_path))
    ok_response = _response(201, {"upserted": True, "matchId": "match-1"})

    with patch.object(client._session, "post", return_value=ok_response) as post:
        result = client.post_replay({"replayHash": "abc"})

    assert result.upserted is True
    assert result.match_id == "match-1"
    post.assert_called_once()
    assert post.call_args.kwargs["json"] == {"replayHash": "abc"}


def test_post_replay_stale_version(tmp_path):
    client = ApiClient(_config(tmp_path))
    ok_response = _response(200, {"upserted": False, "matchId": "match-1", "reason": "stale_version"})

    with patch.object(client._session, "post", return_value=ok_response):
        result = client.post_replay({"replayHash": "abc"})

    assert result.upserted is False
    assert result.reason == "stale_version"


def test_post_replay_auth_error_not_retried(tmp_path):
    client = ApiClient(_config(tmp_path))
    unauthorized = _response(401, {"error": "Invalid or revoked token"})

    with patch.object(client._session, "post", return_value=unauthorized) as post:
        with pytest.raises(AuthError):
            client.post_replay({"replayHash": "abc"})

    post.assert_called_once()


def test_post_replay_validation_error_not_retried(tmp_path):
    client = ApiClient(_config(tmp_path))
    bad_request = _response(400, {"error": {"fieldErrors": {"map": ["Required"]}}})

    with patch.object(client._session, "post", return_value=bad_request) as post:
        with pytest.raises(ValidationError) as exc_info:
            client.post_replay({"replayHash": "abc"})

    assert exc_info.value.detail == {"error": {"fieldErrors": {"map": ["Required"]}}}
    post.assert_called_once()


def test_post_replay_retries_network_errors_then_raises(tmp_path):
    client = ApiClient(_config(tmp_path))

    with patch.object(client._session, "post", side_effect=requests.ConnectionError("offline")) as post:
        with patch("src.api_client.time.sleep"):
            with pytest.raises(ApiClientError):
                client.post_replay({"replayHash": "abc"})

    assert post.call_count == 4


def test_post_replay_retries_then_succeeds(tmp_path):
    client = ApiClient(_config(tmp_path))
    ok_response = _response(201, {"upserted": True, "matchId": "match-1"})

    with patch.object(
        client._session, "post", side_effect=[requests.ConnectionError("offline"), ok_response]
    ) as post:
        with patch("src.api_client.time.sleep"):
            result = client.post_replay({"replayHash": "abc"})

    assert result.upserted is True
    assert post.call_count == 2


def test_post_replay_retries_5xx_then_raises(tmp_path):
    client = ApiClient(_config(tmp_path))
    server_error = _response(503, {"error": "unavailable"})

    with patch.object(client._session, "post", return_value=server_error) as post:
        with patch("src.api_client.time.sleep"):
            with pytest.raises(ApiClientError):
                client.post_replay({"replayHash": "abc"})

    assert post.call_count == 4


def test_ping_health_true_on_200():
    with patch("src.api_client.requests.get", return_value=_response(200, {"status": "ok"})) as get:
        assert ping_health("https://api.example.com/") is True
    get.assert_called_once_with("https://api.example.com/health", timeout=3.0)


def test_ping_health_false_on_non_200():
    with patch("src.api_client.requests.get", return_value=_response(503, {})):
        assert ping_health("https://api.example.com") is False


def test_ping_health_false_on_network_error():
    with patch("src.api_client.requests.get", side_effect=requests.ConnectionError("offline")):
        assert ping_health("https://api.example.com") is False


def test_fetch_summary_returns_body_on_200():
    body = {"gamesPlayed": 42, "wins": 20, "winrate": 0.47, "avgDurationSeconds": 1200}
    with patch("src.api_client.requests.get", return_value=_response(200, body)) as get:
        assert fetch_summary("https://api.example.com", "hots_pat_abc") == body
    assert get.call_args.kwargs["headers"] == {"Authorization": "Bearer hots_pat_abc"}


def test_fetch_summary_none_on_401():
    with patch("src.api_client.requests.get", return_value=_response(401, {"error": "Invalid token"})):
        assert fetch_summary("https://api.example.com", "bad-token") is None


def test_fetch_summary_none_on_network_error():
    with patch("src.api_client.requests.get", side_effect=requests.ConnectionError("offline")):
        assert fetch_summary("https://api.example.com", "hots_pat_abc") is None
