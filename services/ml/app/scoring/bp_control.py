"""30-day blood pressure control assessment from home-logged readings.

Three pieces, computed over a rolling `CONTROL_WINDOW_DAYS`-day window ending
at `as_of` (defaults to the latest reading, keeping the function pure and
independent of wall-clock time):

- **Control rate**: percent of readings below `control_systolic`/`control_diastolic`.
  Defaults to the WHO/ISH general-population threshold (140/90); callers pass a
  tighter threshold (e.g. 130/80) for patients where that's the clinical target.
- **Variability**: mean, SD, and coefficient of variation of systolic readings
  in the window — the standard summary stats used in home-BP variability
  literature.
- **`morning_surge_flag`**: patients here log readings via WhatsApp/app, not
  continuous ambulatory monitoring, so the literal Kario morning-surge metric
  (morning SBP minus the lowest *nocturnal* SBP, >=35-55 mmHg) isn't
  computable — we have no sleep-period reading. This flag is instead the
  HOPE Asia Network / Kario home-BP-monitoring "morning hypertension"
  threshold: mean morning BP (05:00-10:00 Africa/Lagos) >=135/85 mmHg. It is
  a proxy for surge risk, not a diagnosis of it — label copy shown to
  clinicians/patients should say "morning BP elevated", not "surge detected".
"""

import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

LAGOS_TZ = ZoneInfo("Africa/Lagos")

CONTROL_WINDOW_DAYS = 30
DEFAULT_CONTROL_SYSTOLIC = 140.0
DEFAULT_CONTROL_DIASTOLIC = 90.0

MORNING_HYPERTENSION_SYSTOLIC = 135.0
MORNING_HYPERTENSION_DIASTOLIC = 85.0
MORNING_WINDOW_START_HOUR = 5
MORNING_WINDOW_END_HOUR = 10  # exclusive
MIN_MORNING_READINGS = 2


@dataclass(frozen=True)
class BpReading:
    taken_at: datetime  # must be timezone-aware
    systolic: float
    diastolic: float


@dataclass(frozen=True)
class BpControlAssessment:
    window_start: datetime
    window_end: datetime
    readings_in_window: int
    control_rate_percent: float | None
    systolic_mean: float | None
    systolic_sd: float | None
    systolic_cv_percent: float | None
    morning_readings: int
    morning_systolic_mean: float | None
    morning_diastolic_mean: float | None
    morning_surge_flag: bool | None


def _empty_assessment(window_start: datetime, as_of: datetime) -> BpControlAssessment:
    return BpControlAssessment(
        window_start=window_start,
        window_end=as_of,
        readings_in_window=0,
        control_rate_percent=None,
        systolic_mean=None,
        systolic_sd=None,
        systolic_cv_percent=None,
        morning_readings=0,
        morning_systolic_mean=None,
        morning_diastolic_mean=None,
        morning_surge_flag=None,
    )


def assess_bp_control(
    readings: list[BpReading],
    *,
    control_systolic: float = DEFAULT_CONTROL_SYSTOLIC,
    control_diastolic: float = DEFAULT_CONTROL_DIASTOLIC,
    as_of: datetime | None = None,
) -> BpControlAssessment:
    if not readings:
        raise ValueError("readings must not be empty")

    reference = as_of if as_of is not None else max(r.taken_at for r in readings)
    window_start = reference - timedelta(days=CONTROL_WINDOW_DAYS)
    windowed = [r for r in readings if window_start <= r.taken_at <= reference]

    if not windowed:
        return _empty_assessment(window_start, reference)

    controlled = sum(
        1 for r in windowed if r.systolic < control_systolic and r.diastolic < control_diastolic
    )
    control_rate = round(controlled / len(windowed) * 100, 1)

    systolics = [r.systolic for r in windowed]
    systolic_mean = statistics.fmean(systolics)
    systolic_sd = statistics.stdev(systolics) if len(systolics) >= 2 else 0.0
    systolic_cv = round(systolic_sd / systolic_mean * 100, 1) if systolic_mean else None

    morning = [
        r
        for r in windowed
        if MORNING_WINDOW_START_HOUR
        <= r.taken_at.astimezone(LAGOS_TZ).hour
        < MORNING_WINDOW_END_HOUR
    ]
    morning_systolic_mean: float | None = None
    morning_diastolic_mean: float | None = None
    morning_flag: bool | None = None
    if len(morning) >= MIN_MORNING_READINGS:
        morning_systolic_mean = round(statistics.fmean(r.systolic for r in morning), 1)
        morning_diastolic_mean = round(statistics.fmean(r.diastolic for r in morning), 1)
        morning_flag = (
            morning_systolic_mean >= MORNING_HYPERTENSION_SYSTOLIC
            or morning_diastolic_mean >= MORNING_HYPERTENSION_DIASTOLIC
        )

    return BpControlAssessment(
        window_start=window_start,
        window_end=reference,
        readings_in_window=len(windowed),
        control_rate_percent=control_rate,
        systolic_mean=round(systolic_mean, 1),
        systolic_sd=round(systolic_sd, 1),
        systolic_cv_percent=systolic_cv,
        morning_readings=len(morning),
        morning_systolic_mean=morning_systolic_mean,
        morning_diastolic_mean=morning_diastolic_mean,
        morning_surge_flag=morning_flag,
    )
