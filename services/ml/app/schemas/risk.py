from pydantic import BaseModel, Field

from ..scoring.score2 import MAX_AGE, MIN_AGE, ModelName, RiskLevel, RiskRegion, Sex


class Score2Request(BaseModel):
    age: int = Field(
        ge=MIN_AGE,
        le=MAX_AGE,
        description="Age in whole years. SCORE2 (40-69) and SCORE2-OP (70+) "
        "are both fitted starting at 40; the algorithm is not validated below that.",
    )
    sex: Sex
    is_smoker: bool
    systolic_bp: float = Field(gt=0, le=300, description="Systolic blood pressure, mmHg.")
    total_cholesterol_mg_dl: float = Field(gt=0, le=500)
    hdl_cholesterol_mg_dl: float = Field(gt=0, le=200)
    risk_region: RiskRegion = Field(
        default="very_high",
        description="WHO age-standardised CVD-mortality band SCORE2 is calibrated to. "
        "Defaults to 'very_high' as a conservative placeholder for Nigeria/Sub-Saharan "
        "Africa (SCORE2's derivation cohorts are European; no validated local "
        "calibration exists yet) — override for diaspora patients resident elsewhere.",
    )


class Score2Response(BaseModel):
    cvd_risk_10yr_percent: float
    risk_level: RiskLevel
    model: ModelName
    risk_region: RiskRegion
