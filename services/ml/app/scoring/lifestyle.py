"""Lifestyle programme signals — trends + engagement (heuristic v1).

Support-only advisory signals for the LPE (spec §8.3, §13). Heuristic thresholds
are the starting point; they are versioned so they can be recalibrated as real
patient data accrues, without changing the request/response contract. Pure and
stateless — every value arrives in the request body.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np

SIGNAL_VERSION = "heuristic-v1"


@dataclass(frozen=True)
class TrendPoint:
    taken_at: datetime
    value: float


@dataclass(frozen=True)
class TrendResult:
    points: int
    slope_per_day: float | None
    mean: float | None
    first_value: float | None
    last_value: float | None
    plateau_detected: bool
    signal_version: str


def compute_trend(points: list[TrendPoint], plateau_eps: float = 0.02) -> TrendResult:
    """Least-squares slope (units/day) over the series plus a plateau flag.

    plateau_detected is True when the absolute slope is within `plateau_eps` of
    the mean per day — i.e. the metric is effectively flat.
    """
    if not points:
        return TrendResult(0, None, None, None, None, False, SIGNAL_VERSION)

    ordered = sorted(points, key=lambda p: p.taken_at)
    values = np.array([p.value for p in ordered], dtype=float)
    mean = float(values.mean())

    if len(ordered) < 2:
        return TrendResult(
            len(ordered), None, mean, values[0], values[-1], False, SIGNAL_VERSION
        )

    t0 = ordered[0].taken_at
    days = np.array(
        [(p.taken_at - t0).total_seconds() / 86_400.0 for p in ordered], dtype=float
    )
    # Guard against all-same-timestamp series.
    if float(days.max() - days.min()) == 0.0:
        return TrendResult(
            len(ordered), None, mean, values[0], values[-1], False, SIGNAL_VERSION
        )

    slope, _intercept = np.polyfit(days, values, 1)
    slope = float(slope)
    # Plateau = the metric barely moved across the whole observed window:
    # fractional change |slope * span_days| / |mean| below plateau_eps.
    denom = abs(mean) if mean != 0 else 1.0
    span_days = float(days.max() - days.min())
    fractional_change = abs(slope * span_days) / denom
    plateau = fractional_change < plateau_eps

    return TrendResult(
        points=len(ordered),
        slope_per_day=slope,
        mean=mean,
        first_value=float(values[0]),
        last_value=float(values[-1]),
        plateau_detected=plateau,
        signal_version=SIGNAL_VERSION,
    )


@dataclass(frozen=True)
class EngagementResult:
    days_since_last_log: int | None
    logs_last_14d: int
    expected_logs_last_14d: int
    disengagement_risk: float  # 0..1
    signal_version: str


def compute_engagement(
    log_timestamps: list[datetime],
    as_of: datetime,
    expected_per_week: float = 7.0,
) -> EngagementResult:
    """Heuristic disengagement risk in [0, 1].

    Combines recency (days since last log) with recent adherence (actual vs
    expected logs over the trailing 14 days). Higher = more likely disengaging.
    """
    window_days = 14
    expected_14 = max(1, round(expected_per_week * (window_days / 7.0)))

    if not log_timestamps:
        return EngagementResult(None, 0, expected_14, 1.0, SIGNAL_VERSION)

    ordered = sorted(log_timestamps)
    last = ordered[-1]
    days_since = max(0, (as_of - last).days)
    logs_14 = sum(1 for t in ordered if (as_of - t).days < window_days)

    # Recency component: 0 at same-day, →1 by ~10 days silent.
    recency = min(1.0, days_since / 10.0)
    # Adherence gap component: shortfall vs expected, clamped to [0,1].
    adherence_gap = max(0.0, 1.0 - (logs_14 / expected_14))

    risk = round(min(1.0, 0.6 * recency + 0.4 * adherence_gap), 3)

    return EngagementResult(
        days_since_last_log=days_since,
        logs_last_14d=logs_14,
        expected_logs_last_14d=expected_14,
        disengagement_risk=risk,
        signal_version=SIGNAL_VERSION,
    )
