"""Lifestyle signal tests (heuristic-v1)."""

from datetime import UTC, datetime

from app.scoring.lifestyle import (
    TrendPoint,
    compute_engagement,
    compute_trend,
)

UTC = UTC


def _dt(day: int) -> datetime:
    return datetime(2026, 7, day, 9, 0, tzinfo=UTC)


def test_trend_detects_steady_decline() -> None:
    # 100kg dropping 1kg/day for 5 days — a clear, meaningful decline (~4%).
    points = [TrendPoint(_dt(1 + i), 100 - 1.0 * i) for i in range(5)]
    result = compute_trend(points)
    assert result.slope_per_day is not None
    assert result.slope_per_day < 0
    assert not result.plateau_detected


def test_trend_flags_plateau() -> None:
    points = [TrendPoint(_dt(1 + i), 90.0 + (0.01 if i % 2 else -0.01)) for i in range(6)]
    result = compute_trend(points)
    assert result.plateau_detected


def test_trend_single_point_is_safe() -> None:
    result = compute_trend([TrendPoint(_dt(1), 88.0)])
    assert result.slope_per_day is None
    assert result.mean == 88.0


def test_engagement_no_logs_is_max_risk() -> None:
    result = compute_engagement([], as_of=_dt(20))
    assert result.disengagement_risk == 1.0
    assert result.days_since_last_log is None


def test_engagement_active_patient_is_low_risk() -> None:
    logs = [_dt(6 + i) for i in range(15)]  # daily through the as_of day
    result = compute_engagement(logs, as_of=_dt(20))
    assert result.disengagement_risk < 0.2
    assert result.days_since_last_log == 0


def test_engagement_silent_patient_is_high_risk() -> None:
    logs = [_dt(1), _dt(2)]  # nothing recent
    result = compute_engagement(logs, as_of=_dt(20))
    assert result.disengagement_risk > 0.7
