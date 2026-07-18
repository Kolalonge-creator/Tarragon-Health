"""30-day BP control assessment endpoint (Sprint 4, week 7)."""

from fastapi import APIRouter, Depends

from ..schemas.hypertension import BpControlRequest, BpControlResponse
from ..scoring.bp_control import BpReading, assess_bp_control
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
    )
