"""Batch prediction endpoint (Sprint 4, week 8).

Runs a heterogeneous batch of SCORE2 / HbA1c-trajectory / BP-control
requests via `asyncio.gather`. Each item is evaluated independently — one
bad item returns its own `error` rather than failing the whole batch, since
a corporate/HMO cohort refresh calling this in bulk should not be
all-or-nothing. The underlying scoring functions are pure CPU-bound maths
with no I/O, so `gather` here doesn't buy true parallelism within one
process — it's the idiomatic FastAPI batch shape the caller expects, and it
does let the event loop interleave with other requests during a large batch
rather than blocking the endpoint as one long synchronous call.

Rate-limited to `BATCH_RATE_LIMIT_CALLS` per `BATCH_RATE_LIMIT_WINDOW_SECONDS`
per `X-Service-Key` (see `app/rate_limit.py`) — a batch call is far more
expensive per-request than the single-prediction endpoints, so it gets its
own, much tighter budget.
"""

import asyncio

from fastapi import APIRouter, Depends

from ..rate_limit import require_batch_rate_limit
from ..schemas.batch import (
    BatchItem,
    BatchItemResult,
    BatchPredictionRequest,
    BatchPredictionResponse,
)
from ..schemas.diabetes import HbA1cTrajectoryResponse
from ..schemas.hypertension import BpControlResponse
from ..schemas.risk import Score2Response
from ..scoring.bp_control import BpReading, assess_bp_control
from ..scoring.hba1c import HbA1cReading, hba1c_trajectory
from ..scoring.score2 import score2_risk
from ..security import require_service_key

router = APIRouter(
    prefix="/batch",
    tags=["batch"],
    dependencies=[Depends(require_service_key), Depends(require_batch_rate_limit)],
)


async def _run_item(item: BatchItem) -> BatchItemResult:
    try:
        result: Score2Response | HbA1cTrajectoryResponse | BpControlResponse
        if item.type == "cvd":
            risk_pct, risk_level, model = score2_risk(
                age=item.payload.age,
                sex=item.payload.sex,
                is_smoker=item.payload.is_smoker,
                systolic_bp=item.payload.systolic_bp,
                total_cholesterol_mg_dl=item.payload.total_cholesterol_mg_dl,
                hdl_cholesterol_mg_dl=item.payload.hdl_cholesterol_mg_dl,
                risk_region=item.payload.risk_region,
            )
            result = Score2Response(
                cvd_risk_10yr_percent=risk_pct,
                risk_level=risk_level,
                model=model,
                risk_region=item.payload.risk_region,
            )
        elif item.type == "hba1c":
            trajectory = hba1c_trajectory(
                [
                    HbA1cReading(on=r.on, value_percent=r.value_percent)
                    for r in item.payload.readings
                ]
            )
            result = HbA1cTrajectoryResponse(
                latest_value_percent=trajectory.latest_value_percent,
                estimated_average_glucose_mg_dl=trajectory.estimated_average_glucose_mg_dl,
                estimated_average_glucose_mmol_l=trajectory.estimated_average_glucose_mmol_l,
                trend=trajectory.trend,
                slope_percent_per_90_days=trajectory.slope_percent_per_90_days,
                r_squared=trajectory.r_squared,
                projected_value_percent=trajectory.projected_value_percent,
                projected_value_ci90_low=trajectory.projected_value_ci90_low,
                projected_value_ci90_high=trajectory.projected_value_ci90_high,
            )
        else:
            assessment = assess_bp_control(
                [
                    BpReading(taken_at=r.taken_at, systolic=r.systolic, diastolic=r.diastolic)
                    for r in item.payload.readings
                ],
                control_systolic=item.payload.control_systolic,
                control_diastolic=item.payload.control_diastolic,
                as_of=item.payload.as_of,
            )
            result = BpControlResponse(
                window_start=assessment.window_start,
                window_end=assessment.window_end,
                readings_in_window=assessment.readings_in_window,
                control_rate_percent=assessment.control_rate_percent,
                systolic_mean=assessment.systolic_mean,
                systolic_sd=assessment.systolic_sd,
                systolic_cv_percent=assessment.systolic_cv_percent,
                morning_readings=assessment.morning_readings,
                morning_systolic_mean=assessment.morning_systolic_mean,
                morning_diastolic_mean=assessment.morning_diastolic_mean,
                morning_surge_flag=assessment.morning_surge_flag,
            )
        return BatchItemResult(request_id=item.request_id, type=item.type, ok=True, result=result)
    except Exception as exc:  # isolation must survive any scorer failure, not just ValueError
        return BatchItemResult(request_id=item.request_id, type=item.type, ok=False, error=str(exc))


@router.post("/predict", response_model=BatchPredictionResponse)
async def batch_predict(payload: BatchPredictionRequest) -> BatchPredictionResponse:
    results = await asyncio.gather(*(_run_item(item) for item in payload.items))
    return BatchPredictionResponse(results=list(results))
