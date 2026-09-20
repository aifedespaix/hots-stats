import threading
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from src import auth_flow


def test_make_pkce_pair_matches_the_rfc7636_vector(monkeypatch):
    monkeypatch.setattr(
        auth_flow.secrets, "token_urlsafe", lambda _n: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    )
    verifier, challenge = auth_flow.make_pkce_pair()
    assert verifier == "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def _fake_open(behavior, captured):
    """Returns a webbrowser.open replacement that hits the loopback listener
    the same way a real browser would after the consent page redirects."""

    def _open(url):
        captured["authorize_url"] = url
        query = parse_qs(urlsplit(url).query)
        redirect_uri = query["redirectUri"][0]
        state = query["state"][0]
        target = behavior(redirect_uri, state)
        if target is not None:
            threading.Thread(target=lambda: urlopen(target, timeout=5).read(), daemon=True).start()
        return True

    return _open


def test_request_authorization_returns_the_token(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, s: f"{r}?code=the-code&state={s}", captured)
    )
    exchanged = {}

    def fake_exchange(api_base_url, code, verifier):
        exchanged["code"] = code
        exchanged["verifier"] = verifier
        return "hots_pat_deadbeef"

    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", fake_exchange)

    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test", device_name="TEST-BOX"
    )

    assert result.token == "hots_pat_deadbeef"
    assert result.error is None
    assert captured["authorize_url"].startswith("https://web.test/daemon/authorize?")
    assert "deviceName=TEST-BOX" in captured["authorize_url"]
    assert "codeChallengeMethod=S256" in captured["authorize_url"]
    assert exchanged["code"] == "the-code"
    assert exchanged["verifier"]


def test_request_authorization_rejects_a_state_mismatch(monkeypatch):
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, _s: f"{r}?code=the-code&state=wrong1234", {})
    )
    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", lambda *a, **k: "hots_pat_x")
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test"
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_reports_access_denied(monkeypatch):
    monkeypatch.setattr(
        auth_flow.webbrowser, "open", _fake_open(lambda r, s: f"{r}?error=access_denied&state={s}", {})
    )
    monkeypatch.setattr(auth_flow.api_client, "post_daemon_token", lambda *a, **k: "hots_pat_x")
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test"
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_times_out_without_a_callback(monkeypatch):
    monkeypatch.setattr(auth_flow.webbrowser, "open", _fake_open(lambda r, s: None, {}))
    result = auth_flow.request_authorization(
        api_base_url="https://api.test", web_base_url="https://web.test", timeout=0.3
    )
    assert result.token is None
    assert result.error is not None


def test_request_authorization_honours_a_pre_set_cancel_event(monkeypatch):
    monkeypatch.setattr(auth_flow.webbrowser, "open", _fake_open(lambda r, s: None, {}))
    cancel = threading.Event()
    cancel.set()
    result = auth_flow.request_authorization(
        api_base_url="https://api.test",
        web_base_url="https://web.test",
        timeout=10.0,
        cancel_event=cancel,
    )
    assert result.token is None
    assert result.error is not None
