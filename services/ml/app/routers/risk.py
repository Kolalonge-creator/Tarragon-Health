"""SCORE2 / SCORE2-OP cardiovascular risk endpoint (Sprint 4, week 7)."""

from fastapi import APIRouter, Depends

from ..schemas.risk import HeartAgeRequest, HeartAgeResponse, Score2Request, Score2Response
from ..scoring.heart_age import heart_age
from ..scoring.score2 import score2_risk
from ..security import require_service_key

router = APIRouter(prefix="/risk", tags=["risk"], dependencies=[Depends(require_service_key)])


@router.post("/cvd", response_model=Score2Response)
async def cvd_risk(payload: Score2Request) -> Score2Response:
    risk_pct, risk_level, model = score2_risk(
        age=payload.age,
        sex=payload.sex,
        is_smoker=payload.is_smoker,
        systolic_bp=payload.systolic_bp,
        total_cholesterol_mg_dl=payload.total_cholesterol_mg_dl,
        hdl_cholesterol_mg_dl=payload.hdl_cholesterol_mg_dl,
        risk_region=payload.risk_region,
    )
    return Score2Response(
        cvd_risk_10yr_percent=risk_pct,
        risk_level=risk_level,
        model=model,
        risk_region=payload.risk_region,
    )


@router.post("/heart-age", response_model=HeartAgeResponse)
async def heart_age_risk(payload: HeartAgeRequest) -> HeartAgeResponse:
    result = heart_age(
        age=payload.age,
        sex=payload.sex,
        is_smoker=payload.is_smoker,
        systolic_bp=payload.systolic_bp,
        total_cholesterol_mg_dl=payload.total_cholesterol_mg_dl,
        hdl_cholesterol_mg_dl=payload.hdl_cholesterol_mg_dl,
        risk_region=payload.risk_region,
    )
    return HeartAgeResponse(
        heart_age_years=result.heart_age_years,
        cvd_risk_10yr_percent=result.cvd_risk_10yr_percent,
        reference_risk_10yr_percent=result.reference_risk_10yr_percent,
        model=result.model,
    )
