"""Helpers for the two well-known URLs the settings window links to: the
API's default base URL, and the web dashboard's page where a user generates
their access token."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

DEFAULT_API_BASE_URL = "https://api-hots-stats.aifedespaix.com"
_DEFAULT_FRONTEND_SETTINGS_URL = "https://hots-stats.aifedespaix.com/settings"


def guess_settings_url(api_base_url: str) -> str:
    """Best-effort guess at the web dashboard's Settings page (where access
    tokens are generated) from the API's base URL, following this
    deployment's `api-<domain>` / `api.<domain>` subdomain convention (see
    DEPLOYMENT.md). Falls back to the production dashboard if the given URL
    doesn't look like either — good enough for a "open this in your
    browser" link, not meant to be a strict inverse of the API URL.
    """
    url = api_base_url.strip()
    if not url:
        return _DEFAULT_FRONTEND_SETTINGS_URL
    if "://" not in url:
        url = f"https://{url}"

    parts = urlsplit(url)
    host = parts.netloc
    if host.startswith("api-"):
        frontend_host = host[len("api-") :]
    elif host.startswith("api."):
        frontend_host = "app." + host[len("api.") :]
    else:
        return _DEFAULT_FRONTEND_SETTINGS_URL

    return urlunsplit((parts.scheme, frontend_host, "/settings", "", ""))
