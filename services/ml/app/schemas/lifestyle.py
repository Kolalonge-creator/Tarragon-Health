"""Pydantic v2 schemas for the lifestyle signals endpoints."""

from pydantic import AwareDatetime, BaseModel, Field


class TrendPointIn(BaseModel):
    taken_at: AwareDatetime
    value: float


class TrendRequest(BaseModel):
    points: list[TrendPointIn] = Field(min_length=1)
    plateau_eps: float = Field(
        default=0.02,
        ge=0,
        description="Plateau sensitivity: flat if |slope/day| <= eps * |mean|.",
    )


class TrendResponse(BaseModel):
    points: int
    slope_per_day: float | None
    mean: float | None
    first_value: float | None
    last_value: float | None
    plateau_detected: bool
    signal_version: str


class EngagementRequest(BaseModel):
    log_timestamps: list[AwareDatetime] = Field(default_factory=list)
    as_of: AwareDatetime
    expected_per_week: float = Field(default=7.0, gt=0)


class EngagementResponse(BaseModel):
    days_since_last_log: int | None
    logs_last_14d: int
    expected_logs_last_14d: int
    disengagement_risk: float
    signal_version: str
