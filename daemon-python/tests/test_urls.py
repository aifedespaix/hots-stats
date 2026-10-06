from src.urls import guess_settings_url


def test_guess_settings_url_strips_api_dash_prefix():
    assert guess_settings_url("https://api-hots-stats.aifedespaix.com") == "https://hots-stats.aifedespaix.com/settings"


def test_guess_settings_url_replaces_api_dot_prefix_with_app():
    assert guess_settings_url("https://api.mondomaine.fr") == "https://app.mondomaine.fr/settings"


def test_guess_settings_url_adds_default_scheme():
    assert guess_settings_url("api-hots-stats.aifedespaix.com") == "https://hots-stats.aifedespaix.com/settings"


def test_guess_settings_url_falls_back_for_unrecognized_host():
    assert guess_settings_url("https://example.com") == "https://hots-stats.aifedespaix.com/settings"


def test_guess_settings_url_falls_back_for_empty_input():
    assert guess_settings_url("") == "https://hots-stats.aifedespaix.com/settings"

from src.urls import daemon_authorize_url, daemon_token_url, guess_settings_url, guess_token_page_url, guess_web_base_url


def test_guess_web_base_url_strips_api_dash_prefix():
    assert guess_web_base_url("https://api-hots-stats.aifedespaix.com") == "https://hots-stats.aifedespaix.com"


def test_guess_web_base_url_replaces_api_dot_prefix_with_app():
    assert guess_web_base_url("https://api.mondomaine.fr") == "https://app.mondomaine.fr"


def test_guess_web_base_url_falls_back_for_unrecognized_host():
    assert guess_web_base_url("https://example.com") == "https://hots-stats.aifedespaix.com"


def test_guess_web_base_url_falls_back_for_empty_input():
    assert guess_web_base_url("") == "https://hots-stats.aifedespaix.com"


def test_daemon_authorize_url_appends_the_path():
    assert (
        daemon_authorize_url("https://hots-stats.aifedespaix.com")
        == "https://hots-stats.aifedespaix.com/daemon/authorize"
    )


def test_daemon_token_url_strips_trailing_slash():
    assert daemon_token_url("https://app.example.com/") == "https://app.example.com/daemon/token"


def test_guess_token_page_url_follows_the_api_prefix_convention():
    assert (
        guess_token_page_url("https://api-hots-stats.aifedespaix.com")
        == "https://hots-stats.aifedespaix.com/daemon/token"
    )
