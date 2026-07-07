"""HbA1c trend/trajectory and estimated average glucose (eAG).

eAG uses the Nathan et al. 2008 ADAG-study formula (Diabetes Care 31(8):1473-8):
  eAG(mg/dL) = 28.7 x HbA1c(%) - 46.7
converted to mmol/L with the same glucose factor used across the platform
(`packages/shared`'s `GLUCOSE_MMOL_TO_MGDL`), so both services agree.

The trajectory is an ordinary least-squares fit (`scipy.stats.linregress`) of
HbA1c against time, projected `PROJECTION_HORIZON_DAYS` past the latest
reading with a 90% prediction interval computed from the regression's
residual standard error — the standard textbook simple-linear-regression
prediction interval, not a population reference range.
"""

import math
from dataclasses import dataclass
from datetime import date
from typing import Literal

from scipy import stats

Trend = Literal["improving", "stable", "worsening", "insufficient_data"]

NATHAN_SLOPE_MG_DL = 28.7
NATHAN_INTERCEPT_MG_DL = -46.7
GLUCOSE_MMOL_TO_MGDL = 18.0182

PROJECTION_HORIZON_DAYS = 90
CI_LEVEL = 0.90
MIN_POINTS_FOR_REGRESSION = 2
MIN_POINTS_FOR_CI = 3
# Below this, treat the slope as noise regardless of significance — avoids
# labelling a clinically negligible drift as "improving"/"worsening".
STABLE_SLOPE_THRESHOLD_PERCENT_PER_90D = 0.1
STABLE_P_VALUE_THRESHOLD = 0.10


@dataclass(frozen=True)
class HbA1cReading:
    on: date
    value_percent: float


@dataclass(frozen=True)
class HbA1cTrajectory:
    latest_value_percent: float
    estimated_average_glucose_mg_dl: float
    estimated_average_glucose_mmol_l: float
    trend: Trend
    slope_percent_per_90_days: float | None
    r_squared: float | None
    projected_value_percent: float | None
    projected_value_ci90_low: float | None
    projected_value_ci90_high: float | None


def estimated_average_glucose(hba1c_percent: float) -> tuple[float, float]:
    """Return (mg/dL, mmol/L) via the Nathan/ADAG formula."""
    mg_dl = NATHAN_SLOPE_MG_DL * hba1c_percent + NATHAN_INTERCEPT_MG_DL
    mmol_l = mg_dl / GLUCOSE_MMOL_TO_MGDL
    return round(mg_dl, 1), round(mmol_l, 1)


def _insufficient_data(latest: HbA1cReading) -> HbA1cTrajectory:
    eag_mgdl, eag_mmol = estimated_average_glucose(latest.value_percent)
    return HbA1cTrajectory(
        latest_value_percent=latest.value_percent,
        estimated_average_glucose_mg_dl=eag_mgdl,
        estimated_average_glucose_mmol_l=eag_mmol,
        trend="insufficient_data",
        slope_percent_per_90_days=None,
        r_squared=None,
        projected_value_percent=None,
        projected_value_ci90_low=None,
        projected_value_ci90_high=None,
    )


def hba1c_trajectory(readings: list[HbA1cReading]) -> HbA1cTrajectory:
    """Trend classification, 90-day-ahead projection, and eAG for a patient's
    HbA1c history. Requires >=2 readings on distinct dates for a slope, and
    >=3 for a prediction interval; anything less returns `trend="insufficient_data"`
    rather than a synthetic number."""
    if not readings:
        raise ValueError("readings must not be empty")

    ordered = sorted(readings, key=lambda r: r.on)
    latest = ordered[-1]

    x0 = ordered[0].on
    xs = [(r.on - x0).days for r in ordered]
    ys = [r.value_percent for r in ordered]

    if len(ordered) < MIN_POINTS_FOR_REGRESSION or len(set(xs)) < MIN_POINTS_FOR_REGRESSION:
        return _insufficient_data(latest)

    reg = stats.linregress(xs, ys)
    slope_per_90d = reg.slope * PROJECTION_HORIZON_DAYS
    r_squared = reg.rvalue**2

    # With exactly 2 points the fit is perfect (0 residual degrees of
    # freedom) and reg.pvalue is undefined (nan) — significance testing
    # doesn't apply, so fall back to a magnitude-only check.
    significant = len(xs) < MIN_POINTS_FOR_CI or reg.pvalue < STABLE_P_VALUE_THRESHOLD
    if significant and abs(slope_per_90d) >= STABLE_SLOPE_THRESHOLD_PERCENT_PER_90D:
        trend: Trend = "worsening" if reg.slope > 0 else "improving"
    else:
        trend = "stable"

    x_target = xs[-1] + PROJECTION_HORIZON_DAYS
    projected = reg.intercept + reg.slope * x_target

    ci_low: float | None = None
    ci_high: float | None = None
    n = len(xs)
    if n >= MIN_POINTS_FOR_CI:
        mean_x = sum(xs) / n
        sxx = sum((x - mean_x) ** 2 for x in xs)
        residual_ss = sum(
            (y - (reg.intercept + reg.slope * x)) ** 2 for x, y in zip(xs, ys, strict=True)
        )
        dof = n - 2
        residual_se = math.sqrt(residual_ss / dof)
        pred_se = residual_se * math.sqrt(1 + 1 / n + (x_target - mean_x) ** 2 / sxx)
        t_crit = stats.t.ppf(1 - (1 - CI_LEVEL) / 2, df=dof)
        margin = t_crit * pred_se
        ci_low = round(projected - margin, 2)
        ci_high = round(projected + margin, 2)

    eag_mgdl, eag_mmol = estimated_average_glucose(latest.value_percent)
    return HbA1cTrajectory(
        latest_value_percent=latest.value_percent,
        estimated_average_glucose_mg_dl=eag_mgdl,
        estimated_average_glucose_mmol_l=eag_mmol,
        trend=trend,
        slope_percent_per_90_days=round(slope_per_90d, 3),
        r_squared=round(r_squared, 3),
        projected_value_percent=round(projected, 2),
        projected_value_ci90_low=ci_low,
        projected_value_ci90_high=ci_high,
    )
