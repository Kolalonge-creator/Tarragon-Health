from datetime import date, timedelta

import pytest

from app.scoring.hba1c import HbA1cReading, estimated_average_glucose, hba1c_trajectory


def test_nathan_formula_matches_published_example() -> None:
    # Nathan et al. 2008 (ADAG): eAG(mg/dL) = 28.7*A1C - 46.7. A1C=7% is the
    # textbook worked example: eAG = 28.7*7 - 46.7 = 154.2 mg/dL.
    mg_dl, mmol_l = estimated_average_glucose(7.0)
    assert mg_dl == pytest.approx(154.2, abs=0.01)
    # mmol_l is independently rounded to 1dp, same as mg_dl.
    assert mmol_l == pytest.approx(round(154.2 / 18.0182, 1), abs=0.001)


def test_empty_readings_raises() -> None:
    with pytest.raises(ValueError):
        hba1c_trajectory([])


def test_single_reading_is_insufficient_data() -> None:
    result = hba1c_trajectory([HbA1cReading(on=date(2026, 1, 1), value_percent=7.0)])
    assert result.trend == "insufficient_data"
    assert result.slope_percent_per_90_days is None
    assert result.projected_value_ci90_low is None
    assert result.latest_value_percent == 7.0


def test_duplicate_dates_are_insufficient_data() -> None:
    result = hba1c_trajectory(
        [
            HbA1cReading(on=date(2026, 1, 1), value_percent=7.0),
            HbA1cReading(on=date(2026, 1, 1), value_percent=7.5),
        ]
    )
    assert result.trend == "insufficient_data"


def test_two_points_gives_slope_but_no_ci() -> None:
    result = hba1c_trajectory(
        [
            HbA1cReading(on=date(2026, 1, 1), value_percent=8.0),
            HbA1cReading(on=date(2026, 4, 1), value_percent=7.0),
        ]
    )
    assert result.trend == "improving"
    assert result.slope_percent_per_90_days is not None
    assert result.slope_percent_per_90_days < 0
    assert result.projected_value_ci90_low is None
    assert result.projected_value_ci90_high is None


def test_worsening_trend_with_ci() -> None:
    # Deliberately not a perfectly straight line — a perfect fit has zero
    # residual variance and therefore a zero-width prediction interval.
    start = date(2025, 1, 1)
    readings = [
        HbA1cReading(on=start, value_percent=6.5),
        HbA1cReading(on=start + timedelta(days=90), value_percent=7.3),
        HbA1cReading(on=start + timedelta(days=180), value_percent=7.8),
        HbA1cReading(on=start + timedelta(days=270), value_percent=8.7),
    ]
    result = hba1c_trajectory(readings)
    assert result.trend == "worsening"
    assert result.slope_percent_per_90_days == pytest.approx(0.7, abs=0.05)
    assert result.projected_value_ci90_low is not None
    assert result.projected_value_percent is not None
    assert result.projected_value_ci90_high is not None
    assert result.projected_value_ci90_low < result.projected_value_percent
    assert result.projected_value_percent < result.projected_value_ci90_high


def test_flat_readings_are_stable() -> None:
    start = date(2025, 1, 1)
    readings = [
        HbA1cReading(on=start, value_percent=6.8),
        HbA1cReading(on=start + timedelta(days=90), value_percent=6.8),
        HbA1cReading(on=start + timedelta(days=180), value_percent=6.9),
        HbA1cReading(on=start + timedelta(days=270), value_percent=6.8),
    ]
    result = hba1c_trajectory(readings)
    assert result.trend == "stable"


def test_readings_need_not_be_pre_sorted() -> None:
    start = date(2025, 1, 1)
    readings = [
        HbA1cReading(on=start + timedelta(days=180), value_percent=7.9),
        HbA1cReading(on=start, value_percent=6.5),
        HbA1cReading(on=start + timedelta(days=90), value_percent=7.2),
    ]
    result = hba1c_trajectory(readings)
    assert result.latest_value_percent == 7.9
