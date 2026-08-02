"""Screening result interpretation — feeds `AbnormalResultHandler`.

Folds one or more inputs for a completed screening into the same shape as
the `screening_results` table (`result_status`, `result_summary`,
`abnormal_flags`) so the TS platform can write the response straight into
that row. The Postgres trigger `handle_abnormal_screening_result`
(supabase/migrations/20260705000003_prevention.sql) then infers
`condition_triggered` from `abnormal_flags` using an exact-token vocabulary
— every flag this module emits is one of those tokens, verbatim, so nothing
here can silently fail to trip the abnormal-result -> Category 1 upgrade
path (CLAUDE.md: "never deprioritise or silently swallow an abnormal
screening result").

Two kinds of screening inputs are supported:

- **Analyte-based** (`hba1c`, `lipid_panel` components, `psa`, fasting
  glucose): classified against `lab_reference.py`'s published cut-offs.
- **Qualitative** (`hiv`, `hep_b`, `hep_c`, `tb_screen`, `malaria_rdt`:
  positive/negative; `sickle_cell_genotype`: genotype string; procedural/
  imaging screens like `mammography`, `cervical_smear`, `fit`: ML cannot
  derive a finding from imaging or pathology, so the caller passes through
  the result the lab/clinician already reported and this module's job is
  just flag-vocabulary standardisation, not classification).
"""

from dataclasses import dataclass, field
from typing import Literal

from .lab_reference import (
    STATUS_SEVERITY,
    AnalyteCode,
    AnalyteResult,
    AnalyteStatus,
    HbA1cUnit,
    Sex,
    classify_analyte,
)

ResultStatus = AnalyteStatus  # normal | borderline | abnormal | critical
QualitativeResult = Literal["positive", "negative"]

# screen_types.code -> abnormal_flags vocabulary token (see module docstring
# and `handle_abnormal_screening_result`'s exact-match array-overlap check).
_SCREEN_TYPE_FLAG: dict[str, str] = {
    "psa": "psa",
    "mammography": "mammography",
    "cervical_smear": "cervical",
    "fit": "fit",
    "hba1c": "hba1c",
    "blood_pressure": "blood_pressure",
    # Sensitive infectious screens — tag so a positive result carries a flag
    # (defence-in-depth for the sensitive-positive gate, which primarily keys
    # off screening_results.screen_type_code; see
    # handle_abnormal_screening_result).
    "hiv": "hiv",
    "hep_b": "hep_b",
    "hep_c": "hep_c",
}

_SICKLE_CELL_NORMAL = {"AA"}
# Carrier/trait genotypes — not disease, but warrant genetic counselling.
_SICKLE_CELL_CARRIER = {"AS", "AC", "AE", "AF"}
# Disease genotypes — chronic condition requiring specialist care coordination.
_SICKLE_CELL_DISEASE = {"SS", "SC", "CC", "S-BETA-THAL"}


@dataclass(frozen=True)
class AnalyteReading:
    code: AnalyteCode
    value: float
    # Only meaningful when code == "hba1c" — see lab_reference.HbA1cUnit.
    hba1c_unit: HbA1cUnit = "percent"


@dataclass(frozen=True)
class ScreeningInterpretation:
    result_status: ResultStatus
    abnormal_flags: list[str]
    analyte_results: list[AnalyteResult] = field(default_factory=list)
    summary: str = ""


def _classify_genotype(genotype: str) -> tuple[ResultStatus, str]:
    normalised = genotype.strip().upper()
    if normalised in _SICKLE_CELL_NORMAL:
        return "normal", f"Genotype {normalised}: normal."
    if normalised in _SICKLE_CELL_CARRIER:
        return (
            "borderline",
            f"Genotype {normalised}: carrier/trait; genetic counselling advised.",
        )
    if normalised in _SICKLE_CELL_DISEASE:
        return (
            "abnormal",
            f"Genotype {normalised}: sickle cell disease; specialist referral needed.",
        )
    # Unrecognised genotype string: escalate rather than silently pass as
    # normal, per CLAUDE.md's never-silently-swallow-an-abnormal-result rule.
    return "abnormal", f"Genotype '{genotype}' not recognised; clinician review required."


def _format_analyte(r: AnalyteResult) -> str:
    if r.value_percent is not None and r.value_mmol_mol is not None:
        return f"{r.code} {r.value_percent:g}% ({r.value_mmol_mol:g} mmol/mol) ({r.status})"
    return f"{r.code} {r.value:g} ({r.status})"


def _summarise(analyte_results: list[AnalyteResult], notes: list[str]) -> str:
    flagged = [_format_analyte(r) for r in analyte_results if r.status != "normal"]
    parts = flagged + notes
    if not parts:
        return "All results within normal range."
    return "; ".join(parts) + "."


def interpret_screening_result(
    *,
    screen_type_code: str,
    sex: Sex,
    age: int,
    analytes: list[AnalyteReading] | None = None,
    qualitative_result: QualitativeResult | None = None,
    genotype: str | None = None,
    procedural_status: ResultStatus | None = None,
) -> ScreeningInterpretation:
    """Interpret one completed screening event.

    Exactly one of `analytes`, `qualitative_result`, `genotype`, or
    `procedural_status` should be populated depending on `screen_type_code`
    — analyte panels use `analytes`; positive/negative tests (HIV, hepatitis,
    TB, malaria RDT) use `qualitative_result`; `sickle_cell_genotype` uses
    `genotype`, classified against AA/AS/SS etc.; a free-text lab result with
    no meaningful abnormal/normal distinction of its own (currently only
    `blood_group`, e.g. "O+") also uses `genotype` as its value carrier but is
    recorded as `other_status="normal"` verbatim — it must NOT run through
    `_classify_genotype`, which is sickle-cell-specific and would wrongly
    flag every real blood-group value as an unrecognised, escalation-worthy
    genotype string; imaging/pathology screens (mammography, cervical smear,
    FIT, clinical breast exam, colonoscopy, bone density, vision check) use
    `procedural_status` since ML cannot derive a finding from imaging or
    pathology itself.
    """
    analytes = analytes or []
    no_input = (
        not analytes
        and qualitative_result is None
        and genotype is None
        and procedural_status is None
    )
    if no_input:
        raise ValueError(
            "at least one of analytes, qualitative_result, genotype, or "
            "procedural_status is required"
        )

    analyte_results = [
        classify_analyte(a.code, a.value, sex=sex, age=age, hba1c_unit=a.hba1c_unit)
        for a in analytes
    ]
    statuses: list[ResultStatus] = [r.status for r in analyte_results]
    flags: list[str] = []
    notes: list[str] = []

    for r in analyte_results:
        if r.flag and r.flag not in flags:
            flags.append(r.flag)

    other_status: ResultStatus | None = None
    other_note: str | None = None
    if genotype is not None:
        if screen_type_code == "sickle_cell_genotype":
            other_status, other_note = _classify_genotype(genotype)
        else:
            # e.g. blood_group: a free-text lab value with no abnormal/
            # normal distinction of its own — never run through the
            # sickle-cell-specific classifier above.
            other_status, other_note = "normal", f"{screen_type_code}: {genotype}."
    elif qualitative_result is not None:
        other_status = "abnormal" if qualitative_result == "positive" else "normal"
        other_note = f"{screen_type_code}: {qualitative_result}."
    elif procedural_status is not None:
        other_status = procedural_status
        other_note = f"{screen_type_code}: {procedural_status}."

    if other_status is not None:
        statuses.append(other_status)
        # genotype/blood_group notes carry the actual VALUE the patient paid
        # to learn (their genotype letters, their blood group) — unlike a
        # qualitative/procedural "normal", dropping it from the summary
        # would silently discard the one piece of information the result
        # exists to report. Those two stay included even when other_status
        # is "normal"; qualitative_result/procedural_status keep the
        # existing normal-results-are-terse behaviour unchanged.
        if other_status != "normal" or genotype is not None:
            notes.append(other_note or "")
        if other_status != "normal":
            mapped_flag = _SCREEN_TYPE_FLAG.get(screen_type_code)
            if mapped_flag and mapped_flag not in flags:
                flags.append(mapped_flag)

    overall_status = max(statuses, key=lambda s: STATUS_SEVERITY[s])

    return ScreeningInterpretation(
        result_status=overall_status,
        abnormal_flags=flags,
        analyte_results=analyte_results,
        summary=_summarise(analyte_results, notes),
    )
