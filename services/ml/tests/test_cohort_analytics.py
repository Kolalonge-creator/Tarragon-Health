import pytest

from app.scoring.cohort_analytics import CohortMember, analyse_cohort


def _member(**overrides: object) -> CohortMember:
    defaults: dict[str, object] = {"age": 45, "sex": "male"}
    defaults.update(overrides)
    return CohortMember(**defaults)  # type: ignore[arg-type]


def test_empty_cohort_rejected() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        analyse_cohort([])


def test_basic_aggregation() -> None:
    members = [
        _member(age=40, sex="male", chronic_conditions=["hypertension"]),
        _member(age=60, sex="female", chronic_conditions=["diabetes", "hypertension"]),
    ]
    result = analyse_cohort(members)
    assert result.cohort_size == 2
    assert result.age_mean == 50.0
    assert result.sex_distribution == {"male": 1, "female": 1}
    assert result.chronic_condition_prevalence_percent == {"hypertension": 100.0, "diabetes": 50.0}


def test_cvd_risk_distribution_ignores_missing_values() -> None:
    members = [
        _member(cvd_risk_level="high", cvd_risk_10yr_percent=12.0),
        _member(cvd_risk_level="low", cvd_risk_10yr_percent=2.0),
        _member(cvd_risk_level=None, cvd_risk_10yr_percent=None),
    ]
    result = analyse_cohort(members)
    assert result.cvd_risk_level_distribution == {"low": 1, "moderate": 0, "high": 1}
    assert result.cvd_risk_mean_percent == 7.0


def test_cvd_risk_mean_none_when_no_data() -> None:
    result = analyse_cohort([_member()])
    assert result.cvd_risk_mean_percent is None
    assert result.bp_control_rate_mean_percent is None


def test_screening_overdue_rate() -> None:
    members = [
        _member(screening_overdue_count=2),
        _member(screening_overdue_count=0),
        _member(screening_overdue_count=0),
        _member(screening_overdue_count=0),
    ]
    result = analyse_cohort(members)
    assert result.screening_overdue_rate_percent == 25.0


def test_abnormal_flags_are_counted_and_ranked() -> None:
    members = [
        _member(abnormal_flags=["hba1c", "psa"]),
        _member(abnormal_flags=["hba1c"]),
        _member(abnormal_flags=[]),
    ]
    result = analyse_cohort(members)
    assert result.abnormal_findings_count == 3
    assert result.top_abnormal_flags[0] == ("hba1c", 2)
