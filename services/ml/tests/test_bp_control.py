from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.scoring.bp_control import BpReading, assess_bp_control, assess_sustained_control

LAGOS = ZoneInfo("Africa/Lagos")


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 6, day, hour, minute, tzinfo=LAGOS)


def _in_month(year: int, month: int, day: int, hour: int = 8) -> datetime:
    return datetime(year, month, day, hour, tzinfo=LAGOS)


def test_empty_readings_raises() -> None:
    with pytest.raises(ValueError):
        assess_bp_control([])


def test_control_rate_basic() -> None:
    readings = [
        BpReading(taken_at=_at(1, 8), systolic=135, diastolic=85),  # controlled
        BpReading(taken_at=_at(2, 8), systolic=150, diastolic=95),  # not controlled
        BpReading(taken_at=_at(3, 8), systolic=138, diastolic=88),  # controlled
        BpReading(taken_at=_at(4, 8), systolic=139, diastolic=89),  # controlled
    ]
    result = assess_bp_control(readings)
    assert result.readings_in_window == 4
    assert result.control_rate_percent == 75.0


def test_custom_control_thresholds() -> None:
    readings = [
        BpReading(taken_at=_at(1, 8), systolic=135, diastolic=85),
        BpReading(taken_at=_at(2, 8), systolic=125, diastolic=78),
    ]
    result = assess_bp_control(readings, control_systolic=130, control_diastolic=80)
    assert result.control_rate_percent == 50.0


def test_readings_outside_30_day_window_are_excluded() -> None:
    as_of = _at(30, 8)
    readings = [
        BpReading(taken_at=_at(1, 8), systolic=200, diastolic=120),  # 29 days before, in window
        BpReading(taken_at=as_of - timedelta(days=40), systolic=100, diastolic=60),  # excluded
        BpReading(taken_at=as_of, systolic=135, diastolic=85),
    ]
    result = assess_bp_control(readings, as_of=as_of)
    assert result.readings_in_window == 2


def test_as_of_defaults_to_latest_reading() -> None:
    readings = [
        BpReading(taken_at=_at(1, 8), systolic=135, diastolic=85),
        BpReading(taken_at=datetime(2020, 1, 1, tzinfo=LAGOS), systolic=100, diastolic=60),
    ]
    result = assess_bp_control(readings)
    assert result.window_end == _at(1, 8)
    assert result.readings_in_window == 1


def test_morning_surge_flag_true_when_morning_readings_elevated() -> None:
    readings = [
        BpReading(taken_at=_at(1, 7), systolic=145, diastolic=92),
        BpReading(taken_at=_at(2, 8), systolic=140, diastolic=90),
        BpReading(taken_at=_at(1, 20), systolic=120, diastolic=78),
    ]
    result = assess_bp_control(readings)
    assert result.morning_readings == 2
    assert result.morning_surge_flag is True


def test_morning_surge_flag_false_when_morning_readings_controlled() -> None:
    readings = [
        BpReading(taken_at=_at(1, 7), systolic=120, diastolic=78),
        BpReading(taken_at=_at(2, 8), systolic=125, diastolic=80),
    ]
    result = assess_bp_control(readings)
    assert result.morning_surge_flag is False


def test_morning_surge_flag_none_when_too_few_morning_readings() -> None:
    readings = [
        BpReading(taken_at=_at(1, 7), systolic=180, diastolic=110),
        BpReading(taken_at=_at(1, 20), systolic=120, diastolic=78),
    ]
    result = assess_bp_control(readings)
    assert result.morning_readings == 1
    assert result.morning_surge_flag is None


def test_variability_stats() -> None:
    readings = [
        BpReading(taken_at=_at(1, 8), systolic=130, diastolic=80),
        BpReading(taken_at=_at(2, 8), systolic=140, diastolic=85),
        BpReading(taken_at=_at(3, 8), systolic=120, diastolic=75),
    ]
    result = assess_bp_control(readings)
    assert result.systolic_mean == pytest.approx(130.0)
    assert result.systolic_sd is not None and result.systolic_sd > 0
    assert result.systolic_cv_percent is not None


# --- assess_sustained_control (6-month longitudinal window) -----------------

_JUNE_30 = _in_month(2026, 6, 30)


def test_sustained_empty_readings_raises() -> None:
    with pytest.raises(ValueError):
        assess_sustained_control([])


def test_sustained_flag_true_when_four_of_six_months_elevated() -> None:
    uncontrolled = [
        BpReading(taken_at=_in_month(2026, m, 10), systolic=160, diastolic=100)
        for m in (1, 2, 3, 4)
    ]
    controlled = [
        BpReading(taken_at=_in_month(2026, m, 10), systolic=120, diastolic=78)
        for m in (5, 6)
    ]
    result = assess_sustained_control(uncontrolled + controlled, as_of=_JUNE_30)
    assert result.months_with_data == 6
    assert result.months_elevated == 4
    assert result.sustained_elevation_flag is True


def test_sustained_flag_false_when_fewer_than_four_months_elevated() -> None:
    uncontrolled = [
        BpReading(taken_at=_in_month(2026, m, 10), systolic=160, diastolic=100)
        for m in (1, 2)
    ]
    controlled = [
        BpReading(taken_at=_in_month(2026, m, 10), systolic=120, diastolic=78)
        for m in (3, 4, 5, 6)
    ]
    result = assess_sustained_control(uncontrolled + controlled, as_of=_JUNE_30)
    assert result.months_with_data == 6
    assert result.months_elevated == 2
    assert result.sustained_elevation_flag is False


def test_sustained_flag_false_when_too_few_months_have_data() -> None:
    # Only 2 months have any readings at all, even though both are elevated —
    # not enough evidence to call it sustained, so this reads False, not None.
    readings = [
        BpReading(taken_at=_in_month(2026, m, 10), systolic=170, diastolic=105)
        for m in (5, 6)
    ]
    result = assess_sustained_control(readings, as_of=_JUNE_30)
    assert result.months_with_data == 2
    assert result.sustained_elevation_flag is False


def test_sustained_flag_none_when_window_has_no_data_at_all() -> None:
    # All readings are from 2026, but as_of is far enough in the future that
    # none of them fall inside the trailing 6-month window.
    readings = [BpReading(taken_at=_in_month(2026, 6, 10), systolic=170, diastolic=105)]
    far_future_as_of = _in_month(2028, 6, 30)
    result = assess_sustained_control(readings, as_of=far_future_as_of)
    assert result.months_with_data == 0
    assert result.sustained_elevation_flag is None


def test_sustained_monthly_breakdown_is_chronological_and_complete() -> None:
    readings = [BpReading(taken_at=_in_month(2026, 3, 15), systolic=130, diastolic=80)]
    result = assess_sustained_control(readings, as_of=_JUNE_30)
    assert [m.month_start.month for m in result.months] == [1, 2, 3, 4, 5, 6]
    assert all(m.month_start.year == 2026 for m in result.months)
    march = result.months[2]
    assert march.reading_count == 1
    assert march.control_rate_percent == 100.0
    january = result.months[0]
    assert january.reading_count == 0
    assert january.control_rate_percent is None
