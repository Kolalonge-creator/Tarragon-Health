from pydantic import BaseModel, Field

from ..scoring.cohort_analytics import ChronicCondition, RiskLevel, Sex, Trend


class CohortMemberIn(BaseModel):
    age: int = Field(ge=0, le=120)
    sex: Sex
    chronic_conditions: list[ChronicCondition] = Field(default_factory=list)
    cvd_risk_10yr_percent: float | None = Field(default=None, ge=0, le=100)
    cvd_risk_level: RiskLevel | None = None
    hba1c_trend: Trend | None = None
    bp_control_rate_percent: float | None = Field(default=None, ge=0, le=100)
    screening_overdue_count: int = Field(default=0, ge=0)
    abnormal_flags: list[str] = Field(default_factory=list)


class CohortAnalyticsRequest(BaseModel):
    members: list[CohortMemberIn] = Field(min_length=1)


class AbnormalFlagCount(BaseModel):
    flag: str
    count: int


class CohortAnalyticsResponse(BaseModel):
    cohort_size: int
    age_mean: float
    sex_distribution: dict[str, int]
    chronic_condition_prevalence_percent: dict[str, float]
    cvd_risk_level_distribution: dict[str, int]
    cvd_risk_mean_percent: float | None
    hba1c_trend_distribution: dict[str, int]
    bp_control_rate_mean_percent: float | None
    screening_overdue_rate_percent: float
    abnormal_findings_count: int
    top_abnormal_flags: list[AbnormalFlagCount]
