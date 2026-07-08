from pydantic import BaseModel, Field, model_validator

from ..scoring.lab_reference import AnalyteCode, HbA1cUnit, Sex
from ..scoring.screening_interpretation import QualitativeResult, ResultStatus


class AnalyteReadingIn(BaseModel):
    code: AnalyteCode
    value: float = Field(
        gt=0,
        le=2000,
        description="Value in the analyte's canonical unit: mg/dL for glucose/lipids, "
        "ng/mL for PSA, or whichever unit hba1c_unit selects for HbA1c.",
    )
    hba1c_unit: HbA1cUnit = Field(
        default="percent",
        description="Unit `value` is in when code='hba1c' — 'percent' (NGSP) or "
        "'mmol_mol' (IFCC). Ignored, and must be left at its default, for every "
        "other analyte.",
    )

    @model_validator(mode="after")
    def _hba1c_unit_only_for_hba1c(self) -> "AnalyteReadingIn":
        if self.code != "hba1c" and self.hba1c_unit != "percent":
            raise ValueError(f"hba1c_unit override is not applicable to analyte '{self.code}'")
        return self


class LabInterpretationRequest(BaseModel):
    screen_type_code: str = Field(
        min_length=1, max_length=64, description="screen_types.code, e.g. 'hba1c', 'psa'."
    )
    sex: Sex
    age: int = Field(ge=0, le=120)
    analytes: list[AnalyteReadingIn] = Field(
        default_factory=list,
        description="Analyte panel readings (HbA1c, lipid panel, PSA, fasting glucose).",
    )
    qualitative_result: QualitativeResult | None = Field(
        default=None, description="For positive/negative screens: HIV, hepatitis, TB, malaria RDT."
    )
    genotype: str | None = Field(
        default=None, max_length=32, description="For screen_type_code='sickle_cell_genotype'."
    )
    procedural_status: ResultStatus | None = Field(
        default=None,
        description="For imaging/pathology screens (mammography, cervical smear, FIT, "
        "clinical breast exam, colonoscopy, bone density, vision check) where ML cannot "
        "derive a finding — pass through what the lab/clinician already reported.",
    )

    @model_validator(mode="after")
    def _require_one_input(self) -> "LabInterpretationRequest":
        if not (
            self.analytes
            or self.qualitative_result is not None
            or self.genotype is not None
            or self.procedural_status is not None
        ):
            raise ValueError(
                "at least one of analytes, qualitative_result, genotype, or "
                "procedural_status is required"
            )
        return self


class AnalyteResultOut(BaseModel):
    code: AnalyteCode
    value: float
    status: ResultStatus
    reference_range: str
    flag: str | None
    value_percent: float | None = None
    value_mmol_mol: float | None = None


class LabInterpretationResponse(BaseModel):
    result_status: ResultStatus
    abnormal_flags: list[str]
    analyte_results: list[AnalyteResultOut]
    summary: str
