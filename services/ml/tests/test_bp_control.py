from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.scoring.bp_control import BpReading, assess_bp_control

LAGOS = ZoneInfo("Africa/Lagos")


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 6, day, hour, minute, tzinfo=LAGOS)


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
