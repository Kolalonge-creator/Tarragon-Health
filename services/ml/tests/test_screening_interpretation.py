import pytest

from app.scoring.lab_reference import _ANALYTE_FLAG
from app.scoring.screening_interpretation import (
    _SCREEN_TYPE_FLAG,
    AnalyteReading,
    interpret_screening_result,
)

# Mirrors the exact token arrays `handle_abnormal_screening_result` matches
# against (supabase/migrations/20260705211611_merge_nurse_into_clinician.sql:
# 102-107). Every token either flag map can emit must appear in at least one
# of these arrays, or an abnormal result silently stops mapping to a
# `condition_triggered` category the trigger recognises (CLAUDE.md: never
# silently swallow an abnormal screening result). If the SQL migration's
# arrays ever change, update this set to match or this test will catch the
# drift.
_TRIGGER_RECOGNISED_TOKENS = {
    "bp", "blood_pressure", "hypertension",
    "glucose", "hba1c", "diabetes",
    "psa", "cancer", "mammography", "cervical", "fit",
}


def test_analyte_and_screen_type_flags_are_all_trigger_recognised() -> None:
    emitted_tokens = set(_ANALYTE_FLAG.values()) | set(_SCREEN_TYPE_FLAG.values())
    assert emitted_tokens <= _TRIGGER_RECOGNISED_TOKENS


def test_normal_hba1c_screen() -> None:
    result = interpret_screening_result(
        screen_type_code="hba1c",
        sex="male",
        age=45,
        analytes=[AnalyteReading(code="hba1c", value=5.2)],
    )
    assert result.result_status == "normal"
    assert result.abnormal_flags == []
    assert result.summary == "All results within normal range."


def test_abnormal_hba1c_screen_emits_condition_flag() -> None:
    result = interpret_screening_result(
        screen_type_code="hba1c",
        sex="female",
        age=50,
        analytes=[AnalyteReading(code="hba1c", value=8.1)],
    )
    assert result.result_status == "abnormal"
    assert result.abnormal_flags == ["hba1c"]
    assert "abnormal" in result.summary


def test_lipid_panel_takes_worst_analyte() -> None:
    result = interpret_screening_result(
        screen_type_code="lipid_panel",
        sex="male",
        age=50,
        analytes=[
            AnalyteReading(code="total_cholesterol", value=180),  # normal
            AnalyteReading(code="triglycerides", value=600),  # critical
        ],
    )
    assert result.result_status == "critical"
    assert len(result.analyte_results) == 2


def test_qualitative_positive_is_abnormal_no_condition_flag() -> None:
    result = interpret_screening_result(
        screen_type_code="hiv", sex="male", age=30, qualitative_result="positive"
    )
    assert result.result_status == "abnormal"
    # HIV isn't one of AbnormalResultHandler's named conditions -> falls to
    # 'other' downstream, but must still surface as abnormal, never dropped.
    assert result.abnormal_flags == []


def test_qualitative_negative_is_normal() -> None:
    result = interpret_screening_result(
        screen_type_code="hiv", sex="male", age=30, qualitative_result="negative"
    )
    assert result.result_status == "normal"


def test_genotype_normal() -> None:
    result = interpret_screening_result(
        screen_type_code="sickle_cell_genotype", sex="female", age=25, genotype="AA"
    )
    assert result.result_status == "normal"


def test_genotype_carrier_is_borderline() -> None:
    result = interpret_screening_result(
        screen_type_code="sickle_cell_genotype", sex="female", age=25, genotype="as"
    )
    assert result.result_status == "borderline"


def test_genotype_disease_is_abnormal() -> None:
    result = interpret_screening_result(
        screen_type_code="sickle_cell_genotype", sex="male", age=25, genotype="SS"
    )
    assert result.result_status == "abnormal"


def test_unrecognised_genotype_escalates_rather_than_passes_silently() -> None:
    result = interpret_screening_result(
        screen_type_code="sickle_cell_genotype", sex="male", age=25, genotype="ZZ"
    )
    assert result.result_status == "abnormal"


def test_mammography_procedural_passthrough_with_flag() -> None:
    result = interpret_screening_result(
        screen_type_code="mammography", sex="female", age=52, procedural_status="abnormal"
    )
    assert result.result_status == "abnormal"
    assert result.abnormal_flags == ["mammography"]


def test_cervical_smear_flag_token_matches_trigger_vocabulary() -> None:
    result = interpret_screening_result(
        screen_type_code="cervical_smear", sex="female", age=30, procedural_status="abnormal"
    )
    # Trigger checks the exact token 'cervical', not 'cervical_smear'.
    assert result.abnormal_flags == ["cervical"]


def test_requires_at_least_one_input() -> None:
    with pytest.raises(ValueError, match="at least one"):
        interpret_screening_result(screen_type_code="hba1c", sex="male", age=40)
