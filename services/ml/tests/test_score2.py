"""SCORE2/OP tests.

The two golden cases below are cross-checked by hand against the published
coefficients (see `app/scoring/score2.py` module docstring for sources) —
manual evaluation of the linear predictor, baseline survival, and region
recalibration landed within rounding of what the code produces, for both the
under-70 (SCORE2) and 70+ (SCORE2-OP) branches. If a future refactor moves
these away from ~4.6% and ~37.7% respectively, that's a real regression, not
test flakiness.
"""

import pytest

from app.scoring.score2 import score2_risk


def test_score2_under_70_matches_hand_calculation() -> None:
    risk_pct, risk_level, model = score2_risk(
        age=55,
        sex="male",
        is_smoker=False,
        systolic_bp=130,
        total_cholesterol_mg_dl=190,
        hdl_cholesterol_mg_dl=50,
        risk_region="moderate",
    )
    assert risk_pct == pytest.approx(4.6, abs=0.2)
    assert risk_level == "low"
    assert model == "SCORE2"


def test_score2_op_matches_hand_calculation() -> None:
    risk_pct, risk_level, model = score2_risk(
        age=75,
        sex="female",
        is_smoker=True,
        systolic_bp=160,
        total_cholesterol_mg_dl=220,
        hdl_cholesterol_mg_dl=45,
        risk_region="high",
    )
    assert risk_pct == pytest.approx(37.7, abs=0.3)
    assert risk_level == "high"
    assert model == "SCORE2-OP"


def test_smoking_increases_risk() -> None:
    non_smoker, _, _ = score2_risk(
        age=55,
        sex="male",
        is_smoker=False,
        systolic_bp=130,
        total_cholesterol_mg_dl=190,
        hdl_cholesterol_mg_dl=50,
        risk_region="moderate",
    )
    smoker, _, _ = score2_risk(
        age=55,
        sex="male",
        is_smoker=True,
        systolic_bp=130,
        total_cholesterol_mg_dl=190,
        hdl_cholesterol_mg_dl=50,
        risk_region="moderate",
    )
    assert smoker > non_smoker


def test_higher_systolic_bp_increases_risk() -> None:
    lower, _, _ = score2_risk(
        age=60,
        sex="female",
        is_smoker=False,
        systolic_bp=110,
        total_cholesterol_mg_dl=200,
        hdl_cholesterol_mg_dl=55,
        risk_region="low",
    )
    higher, _, _ = score2_risk(
        age=60,
        sex="female",
        is_smoker=False,
        systolic_bp=170,
        total_cholesterol_mg_dl=200,
        hdl_cholesterol_mg_dl=55,
        risk_region="low",
    )
    assert higher > lower


def test_higher_risk_region_increases_risk_for_same_patient() -> None:
    low, _, _ = score2_risk(
        age=58,
        sex="male",
        is_smoker=True,
        systolic_bp=145,
        total_cholesterol_mg_dl=210,
        hdl_cholesterol_mg_dl=45,
        risk_region="low",
    )
    very_high, _, _ = score2_risk(
        age=58,
        sex="male",
        is_smoker=True,
        systolic_bp=145,
        total_cholesterol_mg_dl=210,
        hdl_cholesterol_mg_dl=45,
        risk_region="very_high",
    )
    assert very_high > low


def test_age_70_boundary_switches_to_score2_op() -> None:
    _, _, model_under = score2_risk(
        age=69,
        sex="male",
        is_smoker=False,
        systolic_bp=130,
        total_cholesterol_mg_dl=200,
        hdl_cholesterol_mg_dl=50,
        risk_region="moderate",
    )
    _, _, model_over = score2_risk(
        age=70,
        sex="male",
        is_smoker=False,
        systolic_bp=130,
        total_cholesterol_mg_dl=200,
        hdl_cholesterol_mg_dl=50,
        risk_region="moderate",
    )
    assert model_under == "SCORE2"
    assert model_over == "SCORE2-OP"


@pytest.mark.parametrize(
    "age,risk_pct,expected",
    [
        (45, 2.4, "low"),
        (45, 2.5, "moderate"),
        (45, 7.5, "high"),
        (60, 4.9, "low"),
        (60, 5.0, "moderate"),
        (60, 10.0, "high"),
        (75, 7.4, "low"),
        (75, 7.5, "moderate"),
        (75, 15.0, "high"),
    ],
)
def test_classification_bands(age: int, risk_pct: float, expected: str) -> None:
    from app.scoring.score2 import _classify

    assert _classify(age, risk_pct) == expected
