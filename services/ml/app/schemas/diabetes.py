from datetime import date

from pydantic import BaseModel, Field

from ..scoring.hba1c import Trend


class HbA1cReadingIn(BaseModel):
    on: date
    value_percent: float = Field(gt=0, le=20)


class HbA1cTrajectoryRequest(BaseModel):
    readings: list[HbA1cReadingIn] = Field(min_length=1)


class HbA1cTrajectoryResponse(BaseModel):
    latest_value_percent: float
    estimated_average_glucose_mg_dl: float
    estimated_average_glucose_mmol_l: float
    trend: Trend
    slope_percent_per_90_days: float | None
    r_squared: float | None
    projected_value_percent: float | None
    projected_value_ci90_low: float | None
    projected_value_ci90_high: float | None
