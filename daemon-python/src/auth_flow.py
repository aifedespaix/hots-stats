"""Browser-based authorization for the daemon: RFC 7636 PKCE plus a one-shot
loopback HTTP listener.

The daemon opens the web dashboard's consent page in the user's browser; the
browser (already signed in) authorizes this machine and is redirected to the
loopback listener with a short-lived, single-use code; the daemon exchanges
that code plus its PKCE verifier for an ordinary personal access token. See
docs/superpowers/specs/2026-09-18-daemon-browser-auth-design.md.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import logging
import secrets
import threading
import time
import webbrowser
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlsplit

from . import api_client
from .urls import daemon_authorize_url, guess_web_base_url

logger = logging.getLogger(__name__)

_CALLBACK_PATH = "/callback"
_POLL_SECONDS = 0.2
_SUCCESS_HTML = (
    "<!doctype html><html lang='fr'><head><meta charset='utf-8'>"
    "<title>HotS Analytics</title></head>"
    "<body style='font-family:Segoe UI,sans-serif;background:#1c1f2e;color:#e8eaf6;"
    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
    "<div style='text-align:center'><h1 style='font-size:20px'>Daemon connecte</h1>"
    "<p style='color:#8b90ad'>Tu peux fermer cet onglet et revenir au daemon.</p>"
    "</div></body></html>"
).encode("utf-8")


@dataclass(frozen=True)
class AuthorizationResult:
    token: str | None = None
    error: str | None = None


def make_pkce_pair() -> tuple[str, str]:
    """Returns (code_verifier, code_challenge) per RFC 7636 S256."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _make_handler(received: dict[str, str], done: threading.Event):
    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 -- http.server's API
            parts = urlsplit(self.path)
            if parts.path != _CALLBACK_PATH:
                self.send_response(404)
                self.end_headers()
                return

            query = parse_qs(parts.query)
            for key in ("code", "state", "error"):
                values = query.get(key)
                if values:
                    received[key] = values[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(_SUCCESS_HTML)))
            self.end_headers()
            self.wfile.write(_SUCCESS_HTML)
            done.set()

        def log_message(self, *_args) -> None:
            """Keeps the daemon's console free of one-shot HTTP noise."""

    return _Handler


def request_authorization(
    *,
    api_base_url: str,
    web_base_url: str | None = None,
    device_name: str | None = None,
    timeout: float = 180.0,
    cancel_event: threading.Event | None = None,
) -> AuthorizationResult:
    """Runs the whole handshake. Never raises and never blocks a Tk thread for
    longer than the timeout; every failure is an AuthorizationResult whose
    error holds a ready-to-display French message."""
    verifier, challenge = make_pkce_pair()
    state = secrets.token_urlsafe(16)
    received: dict[str, str] = {}
    done = threading.Event()

    try:
        server = http.server.HTTPServer(("127.0.0.1", 0), _make_handler(received, done))
    except OSError as err:
        logger.warning("Could not bind the loopback authorization listener: %s", err)
        return AuthorizationResult(error="Impossible d'ouvrir le port local pour la connexion.")

    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, name="hots-auth-callback", daemon=True).start()

    base = (
        web_base_url or api_client.fetch_web_origin(api_base_url) or guess_web_base_url(api_base_url)
    )
    params = {
        "redirectUri": f"http://127.0.0.1:{port}{_CALLBACK_PATH}",
        "state": state,
        "codeChallenge": challenge,
        "codeChallengeMethod": "S256",
    }
    if device_name:
        params["deviceName"] = device_name
    authorize_url = f"{daemon_authorize_url(base)}?{urlencode(params)}"

    try:
        webbrowser.open(authorize_url)
    except Exception:  # noqa: BLE001 -- webbrowser can raise anything at all
        logger.debug("webbrowser.open failed", exc_info=True)

    try:
        deadline = time.monotonic() + timeout
        while not done.is_set():
            if cancel_event is not None and cancel_event.is_set():
                return AuthorizationResult(error="Connexion annulée.")
            if time.monotonic() >= deadline:
                return AuthorizationResult(error="Délai dépassé. Réessaie la connexion.")
            done.wait(_POLL_SECONDS)
    finally:
        server.shutdown()
        server.server_close()

    if received.get("state") != state:
        return AuthorizationResult(error="Réponse d'autorisation invalide. Réessaie la connexion.")
    if received.get("error"):
        return AuthorizationResult(error="Autorisation refusée dans le navigateur.")
    code = received.get("code")
    if not code:
        return AuthorizationResult(error="Réponse d'autorisation incomplète.")

    token = api_client.post_daemon_token(api_base_url, code, verifier)
    if not token:
        return AuthorizationResult(error="Le serveur a refusé l'échange du code d'autorisation.")
    return AuthorizationResult(token=token)
