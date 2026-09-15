"""Heart Age — a SCORE2/SCORE2-OP risk-age conversion.

Converts an already-computed, already-validated SCORE2 10-year cardiovascular
risk into an age, using the same published "risk age" technique the SCORE
working group itself uses for patient communication (and the technique
behind the Framingham/JBS3/NHS "vascular age"/"heart age" tools):

  Cooney MT, Dudina A, D'Agostino R, Graham IM. "Value and limitations of
  existing scores for the assessment of cardiovascular risk: a review for
  clinicians." J Am Coll Cardiol. 2009;54(14):1209-1227. (risk-age concept)

  D'Agostino RB Sr, et al. "General cardiovascular risk profile for use in
  primary care: the Framingham Heart Study." Circulation. 2008;117(6):
  743-753. (introduces "vascular age" from a risk score)

  ESC/SCORE2 working group's own risk charts additionally publish a "risk
  age" scale alongside the absolute-risk chart, for exactly this purpose:
  translating a percentage into an age a patient can compare to their own.

This is deliberately NOT a new statistical model. It calls `score2_risk` —
the same coefficients, the same calibration, the same population caveats —
as a subroutine, twice: once with the patient's real risk factors, once with
a reference ("ideal") risk-factor profile at a candidate age, and binary-
searches the candidate age until the two risk percentages match. No new
coefficients are estimated or borrowed here.

REFERENCE-PROFILE CONSTANTS ARE PROVISIONAL. No file in this codebase
publishes a clinically-endorsed "ideal cardiovascular risk-factor profile"
for a risk-age calculation — `lab_reference.py`'s NCEP thresholds are
diagnostic bands (e.g. "desirable" cholesterol), not a single reference
point, and `score2.py`'s own centering constants are statistical artifacts
of the regression, not clinical targets. `PROVISIONAL_REFERENCE_PROFILE`
below uses commonly-cited literature values for a low-risk profile (non-
smoker, SBP 120 mmHg, total cholesterol ~155 mg/dL, HDL ~50 mg/dL) as a
starting point, in the exact same "ship it, mark it unsigned" spirit as
`apps/web/src/lib/rules/cv-risk.ts`'s `PROVISIONAL_CV_RISK_CONFIG` — a
Clinical Director should confirm or adjust these before this feature is
ever switched on for patients (see `heart_age_card` feature flag, shipped
`status='off'`).
"""

from dataclasses import dataclass

from .score2 import MAX_AGE, MIN_AGE, ModelName, RiskRegion, Sex, score2_risk

# See module docstring — provisional pending Clinical Director sign-off,
# never silently treated as final. Mirrors PROVISIONAL_CV_RISK_CONFIG's
# "ship the plumbing, mark it unsigned" pattern.
REFERENCE_IS_SMOKER = False
REFERENCE_SYSTOLIC_BP_MMHG = 120.0
REFERENCE_TOTAL_CHOLESTEROL_MG_DL = 155.0
REFERENCE_HDL_CHOLESTEROL_MG_DL = 50.0

# Binary search precision: a whole-year age is the smallest meaningful unit
# to show a patient, so there is nothing to gain from resolving finer than
# integer years.
_MAX_SEARCH_ITERATIONS = 8  # log2(MAX_AGE - MIN_AGE) ≈ 5.6; 8 is a safety margin.


@dataclass(frozen=True)
class HeartAgeResult:
    heart_age_years: int
    cvd_risk_10yr_percent: float
    reference_risk_10yr_percent: float
    model: ModelName


def heart_age(
    *,
    age: int,
    sex: Sex,
    is_smoker: bool,
    systolic_bp: float,
    total_cholesterol_mg_dl: float,
    hdl_cholesterol_mg_dl: float,
    risk_region: RiskRegion,
) -> HeartAgeResult:
    """The age at which a low-risk reference person of the same sex would
    carry the same 10-year CVD risk this patient's real risk factors produce.

    Uses the patient's own `risk_region` for BOTH the real-risk lookup and
    the reference-profile search, so Heart Age is never silently calibrated
    to a different WHO region than the `cvd_10yr` percentage shown alongside
    it for the same patient — the two numbers must stay internally
    consistent (see the caller in screening-result-actions.ts, which passes
    through the same implicit "very_high" default used for `cvd_10yr`
    today).
    """
    patient_risk_pct, _, model = score2_risk(
        age=age,
        sex=sex,
        is_smoker=is_smoker,
        systolic_bp=systolic_bp,
        total_cholesterol_mg_dl=total_cholesterol_mg_dl,
        hdl_cholesterol_mg_dl=hdl_cholesterol_mg_dl,
        risk_region=risk_region,
    )

    def reference_risk_at(candidate_age: int) -> float:
        risk_pct, _, _ = score2_risk(
            age=candidate_age,
            sex=sex,
            is_smoker=REFERENCE_IS_SMOKER,
            systolic_bp=REFERENCE_SYSTOLIC_BP_MMHG,
            total_cholesterol_mg_dl=REFERENCE_TOTAL_CHOLESTEROL_MG_DL,
            hdl_cholesterol_mg_dl=REFERENCE_HDL_CHOLESTEROL_MG_DL,
            risk_region=risk_region,
        )
        return risk_pct

    # Monotonic increasing in age (confirmed structurally: score2_risk's age
    # coefficient is positive for every sex/age-band combination in _BETAS,
    # and the age-interaction terms are small relative to the main effect
    # across the realistic reference-profile range) — a plain integer binary
    # search over [MIN_AGE, MAX_AGE] is valid and terminates in at most
    # log2(MAX_AGE - MIN_AGE) steps.
    low, high = MIN_AGE, MAX_AGE
    for _ in range(_MAX_SEARCH_ITERATIONS):
        if low >= high:
            break
        mid = (low + high) // 2
        if reference_risk_at(mid) < patient_risk_pct:
            low = mid + 1
        else:
            high = mid

    heart_age_years = low
    reference_risk_pct = reference_risk_at(heart_age_years)

    return HeartAgeResult(
        heart_age_years=heart_age_years,
        cvd_risk_10yr_percent=patient_risk_pct,
        reference_risk_10yr_percent=reference_risk_pct,
        model=model,
    )
