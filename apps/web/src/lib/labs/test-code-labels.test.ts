import { TEST_CODE_LABELS, testCodeLabel, testCodeLabels } from "./test-code-labels";

/**
 * Every distinct code currently used by `panel_bundles.test_codes` on the live
 * project (2026-08-12). If a bundle starts using a new code, add it here and to
 * the map — the fallback keeps the UI safe in the meantime, but a patient-facing
 * name should be a deliberate choice, not a de-snake-cased guess.
 */
const CODES_IN_USE = [
  "abdominal_ultrasound",
  "blood_group",
  "breast_imaging",
  "cervical_smear",
  "ecg_resting",
  "fbc",
  "fit",
  "hba1c",
  "hep_b",
  "hep_c",
  "hiv",
  "kft",
  "lft",
  "lipid_panel",
  "ogtt_fpg",
  "prostate_ultrasound",
  "psa",
  "sickle_cell_genotype",
  "syphilis",
  "tft",
  "urinalysis",
  "urine_acr",
];

describe("test code labels", () => {
  it("covers every code the live panel bundles actually use", () => {
    const missing = CODES_IN_USE.filter((code) => !TEST_CODE_LABELS[code]);
    expect(missing).toEqual([]);
  });

  it("never shows a patient a raw snake_case identifier", () => {
    for (const code of CODES_IN_USE) {
      expect(testCodeLabel(code)).not.toMatch(/_/);
    }
  });

  it("translates the codes a screening patient is most likely to meet", () => {
    expect(testCodeLabel("hba1c")).toBe("Average blood sugar (HbA1c)");
    expect(testCodeLabel("lft")).toBe("Liver function");
    expect(testCodeLabel("kft")).toBe("Kidney function");
    expect(testCodeLabel("sickle_cell_genotype")).toBe("Genotype (AA/AS/SS)");
  });

  it("degrades an unmapped code to readable text rather than the identifier", () => {
    expect(testCodeLabel("new_fancy_test")).toBe("New fancy test");
  });

  it("de-duplicates while preserving order", () => {
    expect(testCodeLabels(["fbc", "hba1c", "fbc"])).toEqual([
      "Full blood count",
      "Average blood sugar (HbA1c)",
    ]);
  });
});
