"""30-day + 6-month BP control assessment endpoint (Sprint 4, week 7; 6-month
sustained-elevation assessment added to close the "elevated for months",
not just "elevated recently", gap)."""

from fastapi import APIRouter, Depends

from ..schemas.hypertension import (
    BpControlRequest,
    BpControlResponse,
    MonthlyControlOut,
    SustainedControlOut,
)
from ..scoring.bp_control import BpReading, assess_bp_control, assess_sustained_control
from ..security import require_service_key

router = APIRouter(
    prefix="/assess", tags=["hypertension"], dependencies=[Depends(require_service_key)]
)


@router.post("/bp-control", response_model=BpControlResponse)
async def bp_control(payload: BpControlRequest) -> BpControlResponse:
    readings = [
        BpReading(taken_at=r.taken_at, systolic=r.systolic, diastolic=r.diastolic)
        for r in payload.readings
    ]
    result = assess_bp_control(
        readings,
        control_systolic=payload.control_systolic,
        control_diastolic=payload.control_diastolic,
        as_of=payload.as_of,
    )
    sustained = assess_sustained_control(
        readings,
        control_systolic=payload.control_systolic,
        control_diastolic=payload.control_diastolic,
        as_of=payload.as_of,
    )
    return BpControlResponse(
        window_start=result.window_start,
        window_end=result.window_end,
        readings_in_window=result.readings_in_window,
        control_rate_percent=result.control_rate_percent,
        systolic_mean=result.systolic_mean,
        systolic_sd=result.systolic_sd,
        systolic_cv_percent=result.systolic_cv_percent,
        morning_readings=result.morning_readings,
        morning_systolic_mean=result.morning_systolic_mean,
        morning_diastolic_mean=result.morning_diastolic_mean,
        morning_surge_flag=result.morning_surge_flag,
        sustained=SustainedControlOut(
            window_start=sustained.window_start,
            window_end=sustained.window_end,
            months=[
                MonthlyControlOut(
                    month_start=m.month_start,
                    control_rate_percent=m.control_rate_percent,
                    reading_count=m.reading_count,
                )
                for m in sustained.months
            ],
            months_with_data=sustained.months_with_data,
            months_elevated=sustained.months_elevated,
            sustained_elevation_flag=sustained.sustained_elevation_flag,
        ),
    )
