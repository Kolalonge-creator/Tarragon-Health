"""Population cohort analytics — powers corporate/HMO dashboards.

Stateless by construction: the caller (TS platform) gathers each member's
already-computed latest figures — SCORE2 result, HbA1c trend, BP control
rate, screening compliance — from Postgres and posts the batch here. This
module only aggregates; it never sees raw patient identifiers, so a
corporate/HMO dashboard fed from this endpoint is workforce-health data, not
per-employee data (CLAUDE.md's B2B corporate dashboard spec: "abnormal
findings (anonymised)").
"""

import statistics
from dataclasses import dataclass, field
from typing import Literal

from .hba1c import Trend as Trend
from .score2 import RiskLevel as RiskLevel
from .score2 import Sex as Sex

ChronicCondition = Literal["hypertension", "diabetes"]


@dataclass(frozen=True)
class CohortMember:
    age: int
    sex: Sex
    chronic_conditions: list[ChronicCondition] = field(default_factory=list)
    cvd_risk_10yr_percent: float | None = None
    cvd_risk_level: RiskLevel | None = None
    hba1c_trend: Trend | None = None
    bp_control_rate_percent: float | None = None
    screening_overdue_count: int = 0
    abnormal_flags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class CohortAnalytics:
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
    top_abnormal_flags: list[tuple[str, int]]


TOP_ABNORMAL_FLAGS_LIMIT = 10


def analyse_cohort(members: list[CohortMember]) -> CohortAnalytics:
    if not members:
        raise ValueError("members must not be empty")

    n = len(members)
    age_mean = round(statistics.fmean(m.age for m in members), 1)

    sex_distribution: dict[str, int] = {"male": 0, "female": 0}
    for m in members:
        sex_distribution[m.sex] += 1

    condition_counts: dict[str, int] = {"hypertension": 0, "diabetes": 0}
    for m in members:
        for condition in m.chronic_conditions:
            condition_counts[condition] += 1
    chronic_condition_prevalence_percent = {
        condition: round(count / n * 100, 1) for condition, count in condition_counts.items()
    }

    risk_levels = [m.cvd_risk_level for m in members if m.cvd_risk_level is not None]
    cvd_risk_level_distribution: dict[str, int] = {"low": 0, "moderate": 0, "high": 0}
    for level in risk_levels:
        cvd_risk_level_distribution[level] += 1

    risk_pcts = [m.cvd_risk_10yr_percent for m in members if m.cvd_risk_10yr_percent is not None]
    cvd_risk_mean_percent = round(statistics.fmean(risk_pcts), 1) if risk_pcts else None

    trends = [m.hba1c_trend for m in members if m.hba1c_trend is not None]
    hba1c_trend_distribution: dict[str, int] = {
        "improving": 0,
        "stable": 0,
        "worsening": 0,
        "insufficient_data": 0,
    }
    for trend in trends:
        hba1c_trend_distribution[trend] += 1

    control_rates = [
        m.bp_control_rate_percent for m in members if m.bp_control_rate_percent is not None
    ]
    bp_control_rate_mean_percent = (
        round(statistics.fmean(control_rates), 1) if control_rates else None
    )

    overdue_members = sum(1 for m in members if m.screening_overdue_count > 0)
    screening_overdue_rate_percent = round(overdue_members / n * 100, 1)

    abnormal_findings_count = sum(len(m.abnormal_flags) for m in members)
    flag_counts: dict[str, int] = {}
    for m in members:
        for flag in m.abnormal_flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1
    top_abnormal_flags = sorted(flag_counts.items(), key=lambda kv: kv[1], reverse=True)[
        :TOP_ABNORMAL_FLAGS_LIMIT
    ]

    return CohortAnalytics(
        cohort_size=n,
        age_mean=age_mean,
        sex_distribution=sex_distribution,
        chronic_condition_prevalence_percent=chronic_condition_prevalence_percent,
        cvd_risk_level_distribution=cvd_risk_level_distribution,
        cvd_risk_mean_percent=cvd_risk_mean_percent,
        hba1c_trend_distribution=hba1c_trend_distribution,
        bp_control_rate_mean_percent=bp_control_rate_mean_percent,
        screening_overdue_rate_percent=screening_overdue_rate_percent,
        abnormal_findings_count=abnormal_findings_count,
        top_abnormal_flags=top_abnormal_flags,
    )
