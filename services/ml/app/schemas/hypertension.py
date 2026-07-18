from pydantic import AwareDatetime, BaseModel, Field

from ..scoring.bp_control import DEFAULT_CONTROL_DIASTOLIC, DEFAULT_CONTROL_SYSTOLIC


class BpReadingIn(BaseModel):
    taken_at: AwareDatetime
    systolic: float = Field(gt=0, le=300)
    diastolic: float = Field(gt=0, le=200)


class BpControlRequest(BaseModel):
    readings: list[BpReadingIn] = Field(min_length=1)
    control_systolic: float = Field(
        default=DEFAULT_CONTROL_SYSTOLIC,
        description="Systolic threshold for 'controlled'. Default 140 (WHO/ISH "
        "general population); pass 130 for patients whose clinical target is tighter.",
    )
    control_diastolic: float = Field(default=DEFAULT_CONTROL_DIASTOLIC)
    as_of: AwareDatetime | None = Field(
        default=None,
        description="Reference point for the trailing 30-day window. Defaults to "
        "the latest reading's timestamp so the assessment is reproducible without "
        "depending on wall-clock time.",
    )


class BpControlResponse(BaseModel):
    window_start: AwareDatetime
    window_end: AwareDatetime
    readings_in_window: int
    control_rate_percent: float | None
    systolic_mean: float | None
    systolic_sd: float | None
    systolic_cv_percent: float | None
    morning_readings: int
    morning_systolic_mean: float | None
    morning_diastolic_mean: float | None
    morning_surge_flag: bool | None
