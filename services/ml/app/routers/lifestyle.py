"""Lifestyle programme signal endpoints (trends + engagement).

Advisory, support-only signals for the LPE. Stateless: patient data arrives in
the request body, never pulled by the service (CLAUDE.md ML rules).
"""

from fastapi import APIRouter, Depends

from ..schemas.lifestyle import (
    EngagementRequest,
    EngagementResponse,
    TrendRequest,
    TrendResponse,
)
from ..scoring.lifestyle import (
    TrendPoint,
    compute_engagement,
    compute_trend,
)
from ..security import require_service_key

router = APIRouter(
    prefix="/lifestyle",
    tags=["lifestyle"],
    dependencies=[Depends(require_service_key)],
)


@router.post("/trends", response_model=TrendResponse)
async def trends(payload: TrendRequest) -> TrendResponse:
    result = compute_trend(
        [TrendPoint(taken_at=p.taken_at, value=p.value) for p in payload.points],
        plateau_eps=payload.plateau_eps,
    )
    return TrendResponse(
        points=result.points,
        slope_per_day=result.slope_per_day,
        mean=result.mean,
        first_value=result.first_value,
        last_value=result.last_value,
        plateau_detected=result.plateau_detected,
        signal_version=result.signal_version,
    )


@router.post("/engagement", response_model=EngagementResponse)
async def engagement(payload: EngagementRequest) -> EngagementResponse:
    result = compute_engagement(
        list(payload.log_timestamps),
        as_of=payload.as_of,
        expected_per_week=payload.expected_per_week,
    )
    return EngagementResponse(
        days_since_last_log=result.days_since_last_log,
        logs_last_14d=result.logs_last_14d,
        expected_logs_last_14d=result.expected_logs_last_14d,
        disengagement_risk=result.disengagement_risk,
        signal_version=result.signal_version,
    )
