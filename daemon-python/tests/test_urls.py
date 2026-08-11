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
