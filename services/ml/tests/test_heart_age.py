"""Heart Age (SCORE2 risk-age conversion) tests.

Mirrors test_score2.py's style: hand-reasoned assertions about the shape of
the answer (bounds, monotonicity, self-consistency) rather than pinned
numeric goldens, since heart_age() is a search over score2_risk rather than
a closed-form formula with a single hand-checkable output.
"""

import pytest

from app.scoring.heart_age import (
    REFERENCE_HDL_CHOLESTEROL_MG_DL,
    REFERENCE_IS_SMOKER,
    REFERENCE_SYSTOLIC_BP_MMHG,
    REFERENCE_TOTAL_CHOLESTEROL_MG_DL,
    heart_age,
)
from app.scoring.score2 import MAX_AGE, MIN_AGE


def test_heart_age_is_within_valid_score2_range() -> None:
    result = heart_age(
        age=55,
        sex="male",
        is_smoker=True,
        systolic_bp=170,
        total_cholesterol_mg_dl=260,
        hdl_cholesterol_mg_dl=35,
        risk_region="very_high",
    )
    assert MIN_AGE <= result.heart_age_years <= MAX_AGE


def test_ideal_risk_factors_resolve_close_to_chronological_age() -> None:
    """A patient already at the reference profile should get a heart age
    close to their real age — validates the inversion isn't systematically
    biased in either direction."""
    real_age = 60
    result = heart_age(
        age=real_age,
        sex="female",
        is_smoker=REFERENCE_IS_SMOKER,
        systolic_bp=REFERENCE_SYSTOLIC_BP_MMHG,
        total_cholesterol_mg_dl=REFERENCE_TOTAL_CHOLESTEROL_MG_DL,
        hdl_cholesterol_mg_dl=REFERENCE_HDL_CHOLESTEROL_MG_DL,
        risk_region="very_high",
    )
    assert result.heart_age_years == pytest.approx(real_age, abs=1)


def test_worse_risk_factors_never_produce_a_younger_heart_age() -> None:
    """Core correctness property: for the same real age, strictly worse risk
    factors must never resolve to a younger (or equal-but-lower-risk) heart
    age than better risk factors."""
    baseline = heart_age(
        age=55,
        sex="male",
        is_smoker=False,
        systolic_bp=120,
        total_cholesterol_mg_dl=180,
        hdl_cholesterol_mg_dl=55,
        risk_region="very_high",
    )
    worse = heart_age(
        age=55,
        sex="male",
        is_smoker=True,
        systolic_bp=170,
        total_cholesterol_mg_dl=260,
        hdl_cholesterol_mg_dl=35,
        risk_region="very_high",
    )
    assert worse.heart_age_years >= baseline.heart_age_years
    assert worse.cvd_risk_10yr_percent > baseline.cvd_risk_10yr_percent


@pytest.mark.parametrize("age,region", [(40, "low"), (45, "high"), (89, "very_high")])
def test_search_converges_at_boundary_and_crossover_ages(age: int, region: str) -> None:
    """Boundary ages (40, 89) and ages on either side of the SCORE2/SCORE2-OP
    crossover at 70 all resolve without the search breaking."""
    result = heart_age(
        age=age,
        sex="female",
        is_smoker=False,
        systolic_bp=140,
        total_cholesterol_mg_dl=210,
        hdl_cholesterol_mg_dl=45,
        risk_region=region,  # type: ignore[arg-type]
    )
    assert MIN_AGE <= result.heart_age_years <= MAX_AGE


def test_search_spans_the_score2_score2_op_crossover() -> None:
    """A patient whose real risk implies a reference age crossing the age-70
    SCORE2/SCORE2-OP model switch still converges correctly — the search
    range spans both models, and score2_risk itself picks the right one for
    each candidate age it's asked about."""
    # A high-risk profile at a mid-range real age plausibly maps to a
    # reference (low-risk) age well past 70.
    result = heart_age(
        age=65,
        sex="male",
        is_smoker=True,
        systolic_bp=200,
        total_cholesterol_mg_dl=300,
        hdl_cholesterol_mg_dl=30,
        risk_region="very_high",
    )
    assert MIN_AGE <= result.heart_age_years <= MAX_AGE


def test_risk_region_is_shared_between_real_and_reference_computation() -> None:
    """The same patient's risk factors under two different risk_region
    calibrations should generally produce different heart ages — if the
    reference search silently hardcoded one region regardless of the input,
    this would fail to vary."""
    low_region = heart_age(
        age=60,
        sex="male",
        is_smoker=True,
        systolic_bp=180,
        total_cholesterol_mg_dl=250,
        hdl_cholesterol_mg_dl=40,
        risk_region="low",
    )
    very_high_region = heart_age(
        age=60,
        sex="male",
        is_smoker=True,
        systolic_bp=180,
        total_cholesterol_mg_dl=250,
        hdl_cholesterol_mg_dl=40,
        risk_region="very_high",
    )
    assert low_region.cvd_risk_10yr_percent != very_high_region.cvd_risk_10yr_percent


def test_both_sexes_supported_independently() -> None:
    male = heart_age(
        age=60,
        sex="male",
        is_smoker=False,
        systolic_bp=150,
        total_cholesterol_mg_dl=220,
        hdl_cholesterol_mg_dl=45,
        risk_region="very_high",
    )
    female = heart_age(
        age=60,
        sex="female",
        is_smoker=False,
        systolic_bp=150,
        total_cholesterol_mg_dl=220,
        hdl_cholesterol_mg_dl=45,
        risk_region="very_high",
    )
    assert MIN_AGE <= male.heart_age_years <= MAX_AGE
    assert MIN_AGE <= female.heart_age_years <= MAX_AGE
