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
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

LAGOS_TZ = ZoneInfo("Africa/Lagos")

CONTROL_WINDOW_DAYS = 30
DEFAULT_CONTROL_SYSTOLIC = 140.0
DEFAULT_CONTROL_DIASTOLIC = 90.0

# --- sustained (longitudinal) control assessment ---------------------------
#
# CONTROL_WINDOW_DAYS above answers "how has this patient been doing
# recently" (30 days). It deliberately cannot answer "has this been going on
# for months" — a single good recent week fully masks a longer pattern in a
# 30-day rolling window. This second assessment buckets readings into
# trailing CALENDAR months (Africa/Lagos, matching this module's existing
# timezone convention) and flags sustained elevation only when there's
# genuine multi-month evidence of it, not a single wide window a good recent
# stretch could mask.
LONG_WINDOW_MONTHS = 6
# A month's own control rate below this is "elevated" for that month. Same
# WHO/ISH-referenced "controlled" cutoff the 30-day control rate above uses,
# applied per-month rather than a second, independent clinical judgement.
MONTH_ELEVATED_CONTROL_RATE_THRESHOLD = 50.0
# Require real evidence across the window, not a couple of noisy months, on
# both sides of the flag.
MIN_MONTHS_WITH_DATA_FOR_SUSTAINED_FLAG = 4
MIN_MONTHS_ELEVATED_FOR_SUSTAINED_FLAG = 4

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


@dataclass(frozen=True)
class MonthlyControl:
    month_start: date
    control_rate_percent: float | None
    reading_count: int


@dataclass(frozen=True)
class SustainedControlAssessment:
    window_start: datetime
    window_end: datetime
    months: list[MonthlyControl]
    months_with_data: int
    months_elevated: int
    # None only when there is no data at all in the 6-month window (distinct
    # from False, which means there IS data but not enough of it — or not
    # enough of it elevated — to call the pattern sustained).
    sustained_elevation_flag: bool | None


def _month_start(moment: datetime) -> date:
    local = moment.astimezone(LAGOS_TZ)
    return date(local.year, local.month, 1)


def _add_months(start: date, months: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def assess_sustained_control(
    readings: list[BpReading],
    *,
    control_systolic: float = DEFAULT_CONTROL_SYSTOLIC,
    control_diastolic: float = DEFAULT_CONTROL_DIASTOLIC,
    as_of: datetime | None = None,
) -> SustainedControlAssessment:
    """Trailing LONG_WINDOW_MONTHS calendar-month control breakdown.

    `sustained_elevation_flag` is True only when at least
    MIN_MONTHS_WITH_DATA_FOR_SUSTAINED_FLAG of the trailing months have any
    readings at all, AND at least MIN_MONTHS_ELEVATED_FOR_SUSTAINED_FLAG of
    those months individually had a control rate below
    MONTH_ELEVATED_CONTROL_RATE_THRESHOLD — "poor control in at least 4 of
    the last 6 months with data", not a single wide window a good recent
    stretch could mask.
    """
    if not readings:
        raise ValueError("readings must not be empty")

    reference = as_of if as_of is not None else max(r.taken_at for r in readings)
    reference_month = _month_start(reference)
    earliest_month = _add_months(reference_month, -(LONG_WINDOW_MONTHS - 1))
    window_start = datetime.combine(earliest_month, datetime.min.time(), tzinfo=LAGOS_TZ)

    months: list[MonthlyControl] = []
    for offset in range(LONG_WINDOW_MONTHS):
        month_start = _add_months(earliest_month, offset)
        month_end_exclusive = _add_months(month_start, 1)
        in_month = [
            r
            for r in readings
            if month_start <= r.taken_at.astimezone(LAGOS_TZ).date() < month_end_exclusive
            and r.taken_at <= reference
        ]
        if in_month:
            controlled = sum(
                1
                for r in in_month
                if r.systolic < control_systolic and r.diastolic < control_diastolic
            )
            control_rate: float | None = round(controlled / len(in_month) * 100, 1)
        else:
            control_rate = None
        months.append(
            MonthlyControl(
                month_start=month_start,
                control_rate_percent=control_rate,
                reading_count=len(in_month),
            )
        )

    months_with_data = sum(1 for m in months if m.reading_count > 0)
    months_elevated = sum(
        1
        for m in months
        if m.control_rate_percent is not None
        and m.control_rate_percent < MONTH_ELEVATED_CONTROL_RATE_THRESHOLD
    )
    sustained_elevation_flag = (
        None
        if months_with_data == 0
        else months_with_data >= MIN_MONTHS_WITH_DATA_FOR_SUSTAINED_FLAG
        and months_elevated >= MIN_MONTHS_ELEVATED_FOR_SUSTAINED_FLAG
    )

    return SustainedControlAssessment(
        window_start=window_start,
        window_end=reference,
        months=months,
        months_with_data=months_with_data,
        months_elevated=months_elevated,
        sustained_elevation_flag=sustained_elevation_flag,
    )
