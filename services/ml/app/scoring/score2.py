"""SCORE2 / SCORE2-OP 10-year cardiovascular disease risk.

Coefficients, centering constants, baseline survivals, and region-calibration
scale factors are transcribed verbatim from the published algorithm:

  SCORE2 working group and ESC Cardiovascular risk collaboration.
  "SCORE2 risk prediction algorithms: new models to estimate 10-year risk
  of cardiovascular disease in Europe." Eur Heart J. 2021;42(25):2439-2454.

  SCORE2-OP working group and ESC Cardiovascular risk collaboration.
  "SCORE2-OP risk prediction algorithms: estimating incident cardiovascular
  event risk in older persons in four geographical risk regions."
  Eur Heart J. 2021;42(25):2455-2467.

Cross-checked against the reference implementation in the `RiskScorescvd`
R package (github.com/dvicencio/RiskScorescvd, R/11_SCORE2_func.R), including
the SCORE2-OP baseline-survival offsets (-0.0929 men / -0.229 women) that are
not obvious from the paper's summary tables but are required to reproduce
published results.

The model does not take a diabetes indicator: SCORE2 was fitted on cohorts
that included people with diabetes, but the algorithm is explicitly not
validated for diabetes risk prediction (a separate SCORE2-Diabetes model with
different inputs exists for that population). Since Tarragon's chronic-disease
cohort is diabetes-heavy, callers should treat a `cvd_risk_10yr` result as
indicative rather than definitive for a diabetic patient until SCORE2-Diabetes
is implemented.
"""

import math
from dataclasses import dataclass
from typing import Literal

Sex = Literal["male", "female"]
RiskRegion = Literal["low", "moderate", "high", "very_high"]
RiskLevel = Literal["low", "moderate", "high"]
ModelName = Literal["SCORE2", "SCORE2-OP"]

MIN_AGE = 40
MAX_AGE = 89
OLDER_PERSONS_AGE_THRESHOLD = 70

# Standard clinical conversion factor: cholesterol mmol/L = mg/dL / 38.67
# (molar mass of cholesterol, 386.65 g/mol, expressed per-decilitre).
MG_DL_PER_MMOL_L_CHOLESTEROL = 38.67


@dataclass(frozen=True)
class _Betas:
    age: float
    smoking: float
    sbp: float
    tchol: float
    hdl: float
    age_smoking: float
    age_sbp: float
    age_tchol: float
    age_hdl: float
    baseline_survival: float
    # SCORE2-OP only: offset subtracted inside the exponent before applying
    # baseline_survival. Zero for the under-70 model.
    baseline_offset: float = 0.0


_BETAS: dict[tuple[Sex, bool], _Betas] = {
    ("male", False): _Betas(
        age=0.3742,
        smoking=0.6012,
        sbp=0.2777,
        tchol=0.1458,
        hdl=-0.2698,
        age_smoking=-0.0755,
        age_sbp=-0.0255,
        age_tchol=-0.0281,
        age_hdl=0.0426,
        baseline_survival=0.9605,
    ),
    ("female", False): _Betas(
        age=0.4648,
        smoking=0.7744,
        sbp=0.3131,
        tchol=0.1002,
        hdl=-0.2606,
        age_smoking=-0.1088,
        age_sbp=-0.0277,
        age_tchol=-0.0226,
        age_hdl=0.0613,
        baseline_survival=0.9776,
    ),
    ("male", True): _Betas(
        age=0.0634,
        smoking=0.3524,
        sbp=0.0094,
        tchol=0.0850,
        hdl=-0.3564,
        age_smoking=-0.0247,
        age_sbp=-0.0005,
        age_tchol=0.0073,
        age_hdl=0.0091,
        baseline_survival=0.7576,
        baseline_offset=-0.0929,
    ),
    ("female", True): _Betas(
        age=0.0789,
        smoking=0.4921,
        sbp=0.0102,
        tchol=0.0605,
        hdl=-0.3040,
        age_smoking=-0.0255,
        age_sbp=-0.0004,
        age_tchol=-0.0009,
        age_hdl=0.0154,
        baseline_survival=0.8082,
        baseline_offset=-0.229,
    ),
}

# (risk_region, is_older_persons, sex) -> (scale1, scale2), the Weibull
# recalibration factors per WHO CVD-mortality risk region.
_SCALE: dict[tuple[RiskRegion, bool, Sex], tuple[float, float]] = {
    ("low", False, "male"): (-0.5699, 0.7476),
    ("low", False, "female"): (-0.7380, 0.7019),
    ("moderate", False, "male"): (-0.1565, 0.8009),
    ("moderate", False, "female"): (-0.3143, 0.7701),
    ("high", False, "male"): (0.3207, 0.9360),
    ("high", False, "female"): (0.5710, 0.9369),
    ("very_high", False, "male"): (0.5836, 0.8294),
    ("very_high", False, "female"): (0.9412, 0.8329),
    ("low", True, "male"): (-0.34, 1.19),
    ("low", True, "female"): (-0.52, 1.01),
    ("moderate", True, "male"): (0.01, 1.25),
    ("moderate", True, "female"): (-0.1, 1.1),
    ("high", True, "male"): (0.08, 1.15),
    ("high", True, "female"): (0.38, 1.09),
    ("very_high", True, "male"): (0.05, 0.7),
    ("very_high", True, "female"): (0.38, 0.69),
}


def _classify(age: int, risk_pct: float) -> RiskLevel:
    """Age-banded risk classification, per the SCORE2/OP paper's own tables."""
    if age < 50:
        low_cut, high_cut = 2.5, 7.5
    elif age < OLDER_PERSONS_AGE_THRESHOLD:
        low_cut, high_cut = 5.0, 10.0
    else:
        low_cut, high_cut = 7.5, 15.0

    if risk_pct < low_cut:
        return "low"
    if risk_pct < high_cut:
        return "moderate"
    return "high"


def _linear_predictor(
    betas: _Betas, cage: float, smoker: float, csbp: float, ctchol: float, chdl: float
) -> float:
    return (
        betas.age * cage
        + betas.smoking * smoker
        + betas.sbp * csbp
        + betas.tchol * ctchol
        + betas.hdl * chdl
        + betas.age_smoking * cage * smoker
        + betas.age_sbp * cage * csbp
        + betas.age_tchol * cage * ctchol
        + betas.age_hdl * cage * chdl
    )


def score2_risk(
    *,
    age: int,
    sex: Sex,
    is_smoker: bool,
    systolic_bp: float,
    total_cholesterol_mg_dl: float,
    hdl_cholesterol_mg_dl: float,
    risk_region: RiskRegion,
) -> tuple[float, RiskLevel, ModelName]:
    """10-year fatal + non-fatal CVD risk (%), risk band, and model used.

    `age` selects SCORE2 (40-69) vs SCORE2-OP (70+); both are covered by this
    one function since the underlying algorithm is the same shape, only the
    coefficients, centering, and baseline differ.
    """
    tchol_mmol = total_cholesterol_mg_dl / MG_DL_PER_MMOL_L_CHOLESTEROL
    hdl_mmol = hdl_cholesterol_mg_dl / MG_DL_PER_MMOL_L_CHOLESTEROL
    smoker = 1.0 if is_smoker else 0.0
    is_older = age >= OLDER_PERSONS_AGE_THRESHOLD
    betas = _BETAS[(sex, is_older)]

    if is_older:
        cage = float(age - 73)
        csbp = systolic_bp - 150
        ctchol = tchol_mmol - 6
        chdl = hdl_mmol - 1.4
    else:
        cage = (age - 60) / 5
        csbp = (systolic_bp - 120) / 20
        ctchol = (tchol_mmol - 6) / 1
        chdl = (hdl_mmol - 1.3) / 0.5

    lp = _linear_predictor(betas, cage, smoker, csbp, ctchol, chdl)
    uncalibrated = 1 - betas.baseline_survival ** math.exp(lp + betas.baseline_offset)

    scale1, scale2 = _SCALE[(risk_region, is_older, sex)]
    calibrated = 1 - math.exp(-math.exp(scale1 + scale2 * math.log(-math.log(1 - uncalibrated))))

    risk_pct = round(calibrated * 100, 1)
    model: ModelName = "SCORE2-OP" if is_older else "SCORE2"
    return risk_pct, _classify(age, risk_pct), model
