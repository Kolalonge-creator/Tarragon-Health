"""HbA1c trajectory endpoint (Sprint 4, week 7)."""

from fastapi import APIRouter, Depends

from ..schemas.diabetes import HbA1cTrajectoryRequest, HbA1cTrajectoryResponse
from ..scoring.hba1c import HbA1cReading, hba1c_trajectory
from ..security import require_service_key

router = APIRouter(
    prefix="/trajectory", tags=["diabetes"], dependencies=[Depends(require_service_key)]
)


@router.post("/hba1c", response_model=HbA1cTrajectoryResponse)
async def hba1c(payload: HbA1cTrajectoryRequest) -> HbA1cTrajectoryResponse:
    result = hba1c_trajectory(
        [HbA1cReading(on=r.on, value_percent=r.value_percent) for r in payload.readings]
    )
    return HbA1cTrajectoryResponse(
        latest_value_percent=result.latest_value_percent,
        estimated_average_glucose_mg_dl=result.estimated_average_glucose_mg_dl,
        estimated_average_glucose_mmol_l=result.estimated_average_glucose_mmol_l,
        trend=result.trend,
        slope_percent_per_90_days=result.slope_percent_per_90_days,
        r_squared=result.r_squared,
        projected_value_percent=result.projected_value_percent,
        projected_value_ci90_low=result.projected_value_ci90_low,
        projected_value_ci90_high=result.projected_value_ci90_high,
    )
