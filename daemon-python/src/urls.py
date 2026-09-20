"""Helpers for the well-known URLs the daemon needs: the API's default base
URL, the web dashboard's origin (where the browser handshake happens), and
the dashboard's Settings page (where access tokens are listed)."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

DEFAULT_API_BASE_URL = "https://api-hots-stats.aifedespaix.com"
_DEFAULT_FRONTEND_ORIGIN = "https://hots-stats.aifedespaix.com"


def guess_web_base_url(api_base_url: str) -> str:
    """Best-effort guess at the web dashboard's origin from the API's base URL,
    following this deployment's api-<domain> / api.<domain> subdomain
    convention (see DEPLOYMENT.md). Falls back to the production dashboard if
    the given URL looks like neither -- good enough to open the consent page,
    and the API's own webOrigin (GET /health) is preferred when reachable.
    """
    url = api_base_url.strip()
    if not url:
        return _DEFAULT_FRONTEND_ORIGIN
    if "://" not in url:
        url = f"https://{url}"

    parts = urlsplit(url)
    host = parts.netloc
    if host.startswith("api-"):
        frontend_host = host[len("api-") :]
    elif host.startswith("api."):
        frontend_host = "app." + host[len("api.") :]
    else:
        return _DEFAULT_FRONTEND_ORIGIN

    return urlunsplit((parts.scheme, frontend_host, "", "", ""))


def guess_settings_url(api_base_url: str) -> str:
    """The dashboard page where access tokens are generated and listed."""
    return f"{guess_web_base_url(api_base_url)}/settings"


def daemon_authorize_url(web_base_url: str) -> str:
    """The consent page the browser must open for the loopback handshake."""
    return f"{web_base_url.rstrip('/')}/daemon/authorize"
