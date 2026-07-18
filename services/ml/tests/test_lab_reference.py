import pytest

from app.scoring.lab_reference import (
    classify_analyte,
    hba1c_mmol_mol_to_percent,
    hba1c_percent_to_mmol_mol,
)


def test_fasting_glucose_normal() -> None:
    r = classify_analyte("fasting_glucose", 90, sex="male", age=45)
    assert r.status == "normal"
    assert r.flag is None


def test_fasting_glucose_borderline_prediabetes() -> None:
    r = classify_analyte("fasting_glucose", 110, sex="male", age=45)
    assert r.status == "borderline"
    assert r.flag == "glucose"


def test_fasting_glucose_abnormal_diabetes() -> None:
    r = classify_analyte("fasting_glucose", 140, sex="female", age=50)
    assert r.status == "abnormal"
    assert r.flag == "glucose"


def test_fasting_glucose_critical() -> None:
    r = classify_analyte("fasting_glucose", 260, sex="male", age=45)
    assert r.status == "critical"
    assert r.flag == "glucose"


def test_hba1c_boundary_5point7_is_borderline_not_normal() -> None:
    # Regression guard: a naive "normal_max=5.6, value > normal_max" scheme
    # would misclassify 5.65 as borderline even though ADA says <5.7 is
    # normal. Threshold semantics must use the exact 5.7 clinical cut-off.
    assert classify_analyte("hba1c", 5.65, sex="male", age=50).status == "normal"
    assert classify_analyte("hba1c", 5.7, sex="male", age=50).status == "borderline"


def test_hba1c_diabetes_threshold() -> None:
    r = classify_analyte("hba1c", 7.9, sex="female", age=55)
    assert r.status == "abnormal"
    assert r.flag == "hba1c"


def test_hba1c_critical() -> None:
    r = classify_analyte("hba1c", 11.0, sex="male", age=60)
    assert r.status == "critical"


def test_total_cholesterol_bands() -> None:
    assert classify_analyte("total_cholesterol", 180, sex="male", age=45).status == "normal"
    assert classify_analyte("total_cholesterol", 210, sex="male", age=45).status == "borderline"
    assert classify_analyte("total_cholesterol", 260, sex="male", age=45).status == "abnormal"
    assert classify_analyte("total_cholesterol", 310, sex="male", age=45).status == "critical"


def test_ldl_bands() -> None:
    assert classify_analyte("ldl_cholesterol", 100, sex="male", age=45).status == "normal"
    assert classify_analyte("ldl_cholesterol", 140, sex="male", age=45).status == "borderline"
    assert classify_analyte("ldl_cholesterol", 170, sex="male", age=45).status == "abnormal"
    assert classify_analyte("ldl_cholesterol", 200, sex="male", age=45).status == "critical"


def test_triglycerides_bands() -> None:
    assert classify_analyte("triglycerides", 120, sex="male", age=45).status == "normal"
    assert classify_analyte("triglycerides", 600, sex="male", age=45).status == "critical"


def test_hdl_low_is_abnormal_sex_specific() -> None:
    assert classify_analyte("hdl_cholesterol", 35, sex="male", age=45).status == "abnormal"
    assert classify_analyte("hdl_cholesterol", 45, sex="male", age=45).status == "normal"
    assert classify_analyte("hdl_cholesterol", 45, sex="female", age=45).status == "abnormal"
    assert classify_analyte("hdl_cholesterol", 65, sex="female", age=45).status == "normal"


def test_hdl_has_no_condition_flag() -> None:
    # Dyslipidaemia isn't one of AbnormalResultHandler's three named
    # conditions — it correctly falls to 'other', not a fabricated flag.
    r = classify_analyte("hdl_cholesterol", 30, sex="male", age=45)
    assert r.status == "abnormal"
    assert r.flag is None


def test_psa_age_banded() -> None:
    assert classify_analyte("psa", 2.0, sex="male", age=45).status == "normal"
    assert classify_analyte("psa", 3.0, sex="male", age=45).status == "abnormal"
    assert classify_analyte("psa", 3.0, sex="male", age=55).status == "normal"


def test_psa_critical_regardless_of_age_band() -> None:
    r = classify_analyte("psa", 12.0, sex="male", age=42)
    assert r.status == "critical"
    assert r.flag == "psa"


def test_psa_below_youngest_age_band_escalates_rather_than_defaults_to_normal() -> None:
    # No Oesterling band covers ages under 40 — must not silently fall back
    # to the 70+ band's 6.5 ng/mL ceiling and call this "normal".
    r = classify_analyte("psa", 3.0, sex="male", age=25)
    assert r.status == "abnormal"
    assert r.flag == "psa"
    assert "no validated PSA reference range" in r.reference_range


def test_hba1c_percent_to_mmol_mol_matches_ada_published_equivalents() -> None:
    # ADA's own website states these equivalents verbatim: 5.7% = 39
    # mmol/mol, 6.5% = 48 mmol/mol.
    assert hba1c_percent_to_mmol_mol(5.7) == 39
    assert hba1c_percent_to_mmol_mol(6.5) == 48


def test_hba1c_mmol_mol_round_trips_to_percent() -> None:
    assert hba1c_mmol_mol_to_percent(39) == 5.7
    assert hba1c_mmol_mol_to_percent(48) == 6.5


def test_hba1c_classifies_identically_regardless_of_submitted_unit() -> None:
    by_percent = classify_analyte("hba1c", 7.9, sex="male", age=50)
    by_mmol_mol = classify_analyte(
        "hba1c", hba1c_percent_to_mmol_mol(7.9), sex="male", age=50, hba1c_unit="mmol_mol"
    )
    assert by_percent.status == by_mmol_mol.status == "abnormal"
    assert by_percent.flag == by_mmol_mol.flag == "hba1c"


def test_hba1c_result_carries_both_units_regardless_of_input() -> None:
    r = classify_analyte("hba1c", 5.7, sex="male", age=50)
    assert r.value_percent == 5.7
    assert r.value_mmol_mol == 39

    r2 = classify_analyte("hba1c", 48, sex="male", age=50, hba1c_unit="mmol_mol")
    assert r2.value_mmol_mol == 48
    assert r2.value_percent == 6.5
    assert r2.status == "abnormal"


def test_hba1c_unit_override_rejected_for_other_analytes() -> None:
    with pytest.raises(ValueError, match="not applicable"):
        classify_analyte("fasting_glucose", 100, sex="male", age=45, hba1c_unit="mmol_mol")
