"""Population cohort analytics endpoint (Sprint 4, week 8) — powers
corporate/HMO dashboards with anonymised, aggregate-only workforce health
figures (CLAUDE.md B2B dashboard spec)."""

from fastapi import APIRouter, Depends

from ..schemas.analytics import AbnormalFlagCount, CohortAnalyticsRequest, CohortAnalyticsResponse
from ..scoring.cohort_analytics import CohortMember, analyse_cohort
from ..security import require_service_key

router = APIRouter(
    prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_service_key)]
)


@router.post("/cohort", response_model=CohortAnalyticsResponse)
async def cohort(payload: CohortAnalyticsRequest) -> CohortAnalyticsResponse:
    result = analyse_cohort(
        [
            CohortMember(
                age=m.age,
                sex=m.sex,
                chronic_conditions=m.chronic_conditions,
                cvd_risk_10yr_percent=m.cvd_risk_10yr_percent,
                cvd_risk_level=m.cvd_risk_level,
                hba1c_trend=m.hba1c_trend,
                bp_control_rate_percent=m.bp_control_rate_percent,
                screening_overdue_count=m.screening_overdue_count,
                abnormal_flags=m.abnormal_flags,
            )
            for m in payload.members
        ]
    )
    return CohortAnalyticsResponse(
        cohort_size=result.cohort_size,
        age_mean=result.age_mean,
        sex_distribution=result.sex_distribution,
        chronic_condition_prevalence_percent=result.chronic_condition_prevalence_percent,
        cvd_risk_level_distribution=result.cvd_risk_level_distribution,
        cvd_risk_mean_percent=result.cvd_risk_mean_percent,
        hba1c_trend_distribution=result.hba1c_trend_distribution,
        bp_control_rate_mean_percent=result.bp_control_rate_mean_percent,
        screening_overdue_rate_percent=result.screening_overdue_rate_percent,
        abnormal_findings_count=result.abnormal_findings_count,
        top_abnormal_flags=[
            AbnormalFlagCount(flag=f, count=c) for f, c in result.top_abnormal_flags
        ],
    )
