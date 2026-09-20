from src import ui_kit


def test_fonts_for_scale_1_0_matches_todays_hardcoded_sizes():
    fonts = ui_kit.Fonts.for_scale(1.0)
    assert fonts.body == ("Segoe UI", 10)
    assert fonts.muted == ("Segoe UI", 9)
    assert fonts.section == ("Segoe UI", 9, "bold")
    assert fonts.title == ("Segoe UI", 15, "bold")
    assert fonts.link == ("Segoe UI", 9, "underline")
    assert fonts.button == ("Segoe UI", 10)
    assert fonts.button_bold == ("Segoe UI", 10, "bold")


def test_fonts_for_scale_scales_every_size_and_rounds():
    fonts = ui_kit.Fonts.for_scale(1.5)
    assert fonts.body == ("Segoe UI", 15)
    assert fonts.title == ("Segoe UI", 23, "bold")  # 15 * 1.5 = 22.5 -> round -> 23


def test_fonts_for_scale_never_produces_a_zero_or_negative_size():
    fonts = ui_kit.Fonts.for_scale(0.01)
    assert fonts.muted[1] >= 1


def test_default_fonts_is_scale_1_0():
    assert ui_kit.DEFAULT_FONTS == ui_kit.Fonts.for_scale(1.0)


class _FakeWinfo:
    def __init__(self, fpixels_per_inch: float) -> None:
        self._fpixels_per_inch = fpixels_per_inch

    def winfo_fpixels(self, distance: str) -> float:
        assert distance == "1i"
        return self._fpixels_per_inch


def test_dpi_scale_factor_at_96_dpi_is_1_0():
    assert ui_kit.dpi_scale_factor(_FakeWinfo(96.0)) == 1.0


def test_dpi_scale_factor_at_150_percent_scaling():
    assert ui_kit.dpi_scale_factor(_FakeWinfo(144.0)) == 1.5
