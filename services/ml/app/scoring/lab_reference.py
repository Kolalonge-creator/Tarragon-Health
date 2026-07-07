"""Nigerian/WHO-aligned laboratory reference ranges and single-analyte
classification.

Nigeria's Federal Ministry of Health guidelines for diabetes and
cardiovascular risk (aligned to the National Multi-Sectoral Action Plan for
NCDs) adopt the WHO/ADA and NCEP ATP III international thresholds directly
rather than publishing distinct Nigeria-specific cut-offs for these metabolic
analytes — unlike haematology indices (e.g. haemoglobin), where
malaria-endemic-population studies do diverge from WHO defaults, there is no
validated local recalibration for glucose/lipid/PSA thresholds. "Nigerian"
and "WHO" ranges therefore converge on the same published numbers here, same
spirit as `score2.py`'s honest note about SCORE2 lacking a Sub-Saharan Africa
calibration cohort.

Sources (published, canonical units only — mg/dL, %, ng/mL, matching what
Nigerian lab printouts report):

  American Diabetes Association. "Standards of Care in Diabetes—2024."
  Diabetes Care 2024;47(Suppl 1):S20-S42. (fasting glucose, HbA1c)

  Expert Panel on Detection, Evaluation, and Treatment of High Blood
  Cholesterol in Adults (NCEP ATP III). JAMA 2001;285(19):2486-2497.
  (total cholesterol, LDL, HDL, triglycerides)

  Oesterling JE et al. "Serum prostate-specific antigen in a community-based
  population of healthy men: establishment of age-specific reference ranges."
  JAMA 1993;270(7):860-864. (age-banded PSA)

  Hoelzel W et al. "IFCC reference system for measurement of haemoglobin A1c
  in human blood and the national standardization schemes in the United
  States, Japan, and Sweden: a method-comparison study." Clin Chem
  2004;50(1):166-174. (NGSP % <-> IFCC mmol/mol master equation)
"""

from dataclasses import dataclass
from typing import Literal

from .score2 import Sex as Sex

AnalyteCode = Literal[
    "fasting_glucose",
    "hba1c",
    "total_cholesterol",
    "hdl_cholesterol",
    "ldl_cholesterol",
    "triglycerides",
    "psa",
]
AnalyteStatus = Literal["normal", "borderline", "abnormal", "critical"]
# HbA1c is reported both ways in practice — ADA/US labs in NGSP %, many
# Nigerian and UK-trained clinicians in IFCC mmol/mol. Every other analyte
# here has one canonical unit; HbA1c is the deliberate exception.
HbA1cUnit = Literal["percent", "mmol_mol"]

# Ordinal severity used to fold several analyte statuses into one overall
# screening result_status (see screening_interpretation.py).
STATUS_SEVERITY: dict[AnalyteStatus, int] = {
    "normal": 0,
    "borderline": 1,
    "abnormal": 2,
    "critical": 3,
}

# screen_types.code / abnormal_flags vocabulary the AbnormalResultHandler
# trigger inspects (supabase/migrations/20260705000003_prevention.sql,
# `handle_abnormal_screening_result`) — kept as exact string tokens so a flag
# emitted here round-trips into a condition_triggered inference downstream.
# Deliberately has no entry for total_cholesterol/ldl_cholesterol/
# triglycerides/hdl_cholesterol: the trigger has no lipid/dyslipidaemia
# `condition_triggered` bucket to route to (only hypertension/diabetes/
# cancer_referral), so a flag for those would have nowhere to round-trip to
# — an abnormal lipid result still escalates correctly on result_status
# alone, it just falls to the trigger's 'other' category. Adding a lipid
# category needs a matching change on the SQL side first; see
# test_analyte_and_screen_type_flags_are_all_trigger_recognised for the
# guard that would need updating alongside it.
_ANALYTE_FLAG: dict[AnalyteCode, str] = {
    "fasting_glucose": "glucose",
    "hba1c": "hba1c",
    "psa": "psa",
}

# All thresholds below are inclusive lower bounds of the named tier (value >=
# threshold), so a value sits in the highest tier whose threshold it meets —
# matching the clinical guidelines' own "X and above" phrasing exactly,
# regardless of how many decimal places a lab report carries.

# ADA fasting plasma glucose (mg/dL): normal <100, prediabetes 100-125,
# diabetes >=126. "Critical" is not an ADA diagnostic category — it's a
# common clinical alerting threshold for severe hyperglycaemia warranting
# same-day contact rather than routine follow-up.
FASTING_GLUCOSE_BORDERLINE_THRESHOLD_MG_DL = 100.0
FASTING_GLUCOSE_ABNORMAL_THRESHOLD_MG_DL = 126.0
FASTING_GLUCOSE_CRITICAL_THRESHOLD_MG_DL = 250.0

# ADA HbA1c (%): normal <5.7, prediabetes 5.7-6.4, diabetes >=6.5. Critical
# threshold (>=10%) is a common poor-glycaemic-control alerting cut-off, not
# an ADA diagnostic category.
HBA1C_BORDERLINE_THRESHOLD_PERCENT = 5.7
HBA1C_ABNORMAL_THRESHOLD_PERCENT = 6.5
HBA1C_CRITICAL_THRESHOLD_PERCENT = 10.0

# NGSP % <-> IFCC mmol/mol master equation (Hoelzel et al. 2004):
#   IFCC (mmol/mol) = (NGSP % - 2.15) * 10.929
# IFCC results are conventionally reported as whole mmol/mol, which is also
# what reproduces the ADA's own published equivalents (5.7% = 39, 6.5% = 48).
HBA1C_IFCC_SLOPE = 10.929
HBA1C_IFCC_INTERCEPT_PERCENT = 2.15


def hba1c_percent_to_mmol_mol(percent: float) -> float:
    return round((percent - HBA1C_IFCC_INTERCEPT_PERCENT) * HBA1C_IFCC_SLOPE, 0)


def hba1c_mmol_mol_to_percent(mmol_mol: float) -> float:
    return round(mmol_mol / HBA1C_IFCC_SLOPE + HBA1C_IFCC_INTERCEPT_PERCENT, 1)


# NCEP ATP III total cholesterol (mg/dL): desirable <200, borderline-high
# 200-239, high >=240. Critical (>=300) is a severe-hypercholesterolaemia
# alerting threshold, not an ATP III category.
TOTAL_CHOLESTEROL_BORDERLINE_THRESHOLD_MG_DL = 200.0
TOTAL_CHOLESTEROL_ABNORMAL_THRESHOLD_MG_DL = 240.0
TOTAL_CHOLESTEROL_CRITICAL_THRESHOLD_MG_DL = 300.0

# NCEP ATP III LDL cholesterol (mg/dL): near-optimal/normal <130,
# borderline-high 130-159, high 160-189, very high >=190.
LDL_BORDERLINE_THRESHOLD_MG_DL = 130.0
LDL_ABNORMAL_THRESHOLD_MG_DL = 160.0
LDL_CRITICAL_THRESHOLD_MG_DL = 190.0

# NCEP ATP III triglycerides (mg/dL): normal <150, borderline-high 150-199,
# high 200-499, very high >=500.
TRIGLYCERIDES_BORDERLINE_THRESHOLD_MG_DL = 150.0
TRIGLYCERIDES_ABNORMAL_THRESHOLD_MG_DL = 200.0
TRIGLYCERIDES_CRITICAL_THRESHOLD_MG_DL = 500.0

# NCEP ATP III HDL cholesterol (mg/dL) — lower is worse (it's the protective
# lipid): abnormal/low <40 (male) / <50 (female); >=60 is explicitly
# protective. Values between the sex-specific low cut-off and 60 are
# unremarkable/normal.
HDL_ABNORMAL_THRESHOLD_MALE_MG_DL = 40.0
HDL_ABNORMAL_THRESHOLD_FEMALE_MG_DL = 50.0
HDL_PROTECTIVE_THRESHOLD_MG_DL = 60.0

# Oesterling age-specific PSA reference ranges (ng/mL), upper bound of normal
# per decade — a value strictly above the band's bound is abnormal. >=10
# ng/mL is the widely used "high suspicion" urgent-referral threshold
# irrespective of age band.
PSA_CRITICAL_THRESHOLD_NG_ML = 10.0
_PSA_AGE_BAND_UPPER_NG_ML: tuple[tuple[int, int, float], ...] = (
    (40, 49, 2.5),
    (50, 59, 3.5),
    (60, 69, 4.5),
    (70, 120, 6.5),
)


@dataclass(frozen=True)
class AnalyteResult:
    code: AnalyteCode
    value: float
    status: AnalyteStatus
    reference_range: str
    # Vocabulary token feeding AbnormalResultHandler's condition inference;
    # None when the analyte is within range or has no mapped condition.
    flag: str | None
    # Populated only for hba1c, in both units regardless of which one was
    # submitted, since clinicians reading the result may expect either.
    value_percent: float | None = None
    value_mmol_mol: float | None = None


def _banded(
    code: AnalyteCode,
    value: float,
    *,
    borderline: float,
    abnormal: float,
    critical: float,
    unit: str,
) -> AnalyteResult:
    """Classify an analyte where higher values are worse (the common case)."""
    if value >= critical:
        status: AnalyteStatus = "critical"
    elif value >= abnormal:
        status = "abnormal"
    elif value >= borderline:
        status = "borderline"
    else:
        status = "normal"
    flag = _ANALYTE_FLAG.get(code) if status != "normal" else None
    return AnalyteResult(
        code=code,
        value=value,
        status=status,
        reference_range=f"<{borderline:.1f} {unit} (normal)",
        flag=flag,
    )


def _classify_hba1c(value: float, unit: HbA1cUnit) -> AnalyteResult:
    if unit == "mmol_mol":
        mmol_mol = value
        percent = hba1c_mmol_mol_to_percent(value)
    else:
        percent = value
        mmol_mol = hba1c_percent_to_mmol_mol(value)

    if percent >= HBA1C_CRITICAL_THRESHOLD_PERCENT:
        status: AnalyteStatus = "critical"
    elif percent >= HBA1C_ABNORMAL_THRESHOLD_PERCENT:
        status = "abnormal"
    elif percent >= HBA1C_BORDERLINE_THRESHOLD_PERCENT:
        status = "borderline"
    else:
        status = "normal"
    flag = _ANALYTE_FLAG["hba1c"] if status != "normal" else None

    borderline_mmol_mol = hba1c_percent_to_mmol_mol(HBA1C_BORDERLINE_THRESHOLD_PERCENT)
    return AnalyteResult(
        code="hba1c",
        value=value,
        status=status,
        reference_range=(
            f"<{HBA1C_BORDERLINE_THRESHOLD_PERCENT:.1f}% "
            f"(<{borderline_mmol_mol:.0f} mmol/mol) (normal)"
        ),
        flag=flag,
        value_percent=round(percent, 1),
        value_mmol_mol=round(mmol_mol, 0),
    )


def _classify_hdl(value: float, sex: Sex) -> AnalyteResult:
    abnormal_threshold = (
        HDL_ABNORMAL_THRESHOLD_MALE_MG_DL if sex == "male" else HDL_ABNORMAL_THRESHOLD_FEMALE_MG_DL
    )
    status: AnalyteStatus = "abnormal" if value < abnormal_threshold else "normal"
    return AnalyteResult(
        code="hdl_cholesterol",
        value=value,
        status=status,
        reference_range=(
            f">={abnormal_threshold:.0f} mg/dL (normal); "
            f">={HDL_PROTECTIVE_THRESHOLD_MG_DL:.0f} protective"
        ),
        flag=None,
    )


def _classify_psa(value: float, age: int) -> AnalyteResult:
    band = next(
        (upper for lo, hi, upper in _PSA_AGE_BAND_UPPER_NG_ML if lo <= age <= hi),
        None,
    )
    if band is None:
        # Oesterling's published bands only cover ages 40-120 — there is no
        # validated PSA reference range below 40. Escalate rather than fall
        # back to an adult band's threshold, which would silently under-flag
        # a result with no clinical basis for calling it normal (CLAUDE.md:
        # never silently swallow an abnormal/uncertain screening result).
        return AnalyteResult(
            code="psa",
            value=value,
            status="abnormal",
            reference_range=(
                f"no validated PSA reference range for age {age} "
                "(Oesterling bands cover ages 40+) - clinician review required"
            ),
            flag=_ANALYTE_FLAG["psa"],
        )
    upper = band
    if value >= PSA_CRITICAL_THRESHOLD_NG_ML:
        status: AnalyteStatus = "critical"
    elif value > upper:
        status = "abnormal"
    else:
        status = "normal"
    flag = _ANALYTE_FLAG["psa"] if status != "normal" else None
    return AnalyteResult(
        code="psa",
        value=value,
        status=status,
        reference_range=f"<={upper:.1f} ng/mL (age {age}, normal)",
        flag=flag,
    )


def classify_analyte(
    code: AnalyteCode,
    value: float,
    *,
    sex: Sex,
    age: int,
    hba1c_unit: HbA1cUnit = "percent",
) -> AnalyteResult:
    """Classify one lab value against its reference range.

    `value` must already be in the analyte's canonical unit: mg/dL for
    glucose/lipids, ng/mL for PSA — matching standard Nigerian lab report
    units, same convention as `score2.py`'s fixed-unit inputs. HbA1c is the
    one exception: `value` may be in either NGSP % or IFCC mmol/mol,
    selected by `hba1c_unit` (ignored for every other analyte); the result
    always carries both units regardless of which one was submitted.
    """
    if code != "hba1c" and hba1c_unit != "percent":
        raise ValueError(f"hba1c_unit override is not applicable to analyte '{code}'")

    if code == "fasting_glucose":
        return _banded(
            code,
            value,
            borderline=FASTING_GLUCOSE_BORDERLINE_THRESHOLD_MG_DL,
            abnormal=FASTING_GLUCOSE_ABNORMAL_THRESHOLD_MG_DL,
            critical=FASTING_GLUCOSE_CRITICAL_THRESHOLD_MG_DL,
            unit="mg/dL",
        )
    if code == "hba1c":
        return _classify_hba1c(value, hba1c_unit)
    if code == "total_cholesterol":
        return _banded(
            code,
            value,
            borderline=TOTAL_CHOLESTEROL_BORDERLINE_THRESHOLD_MG_DL,
            abnormal=TOTAL_CHOLESTEROL_ABNORMAL_THRESHOLD_MG_DL,
            critical=TOTAL_CHOLESTEROL_CRITICAL_THRESHOLD_MG_DL,
            unit="mg/dL",
        )
    if code == "ldl_cholesterol":
        return _banded(
            code,
            value,
            borderline=LDL_BORDERLINE_THRESHOLD_MG_DL,
            abnormal=LDL_ABNORMAL_THRESHOLD_MG_DL,
            critical=LDL_CRITICAL_THRESHOLD_MG_DL,
            unit="mg/dL",
        )
    if code == "triglycerides":
        return _banded(
            code,
            value,
            borderline=TRIGLYCERIDES_BORDERLINE_THRESHOLD_MG_DL,
            abnormal=TRIGLYCERIDES_ABNORMAL_THRESHOLD_MG_DL,
            critical=TRIGLYCERIDES_CRITICAL_THRESHOLD_MG_DL,
            unit="mg/dL",
        )
    if code == "hdl_cholesterol":
        return _classify_hdl(value, sex)
    return _classify_psa(value, age)
