import { TEST_PREPARATION, testPreparationForCodes } from "./test-preparation";

/**
 * Every distinct code currently used by `panel_bundles.test_codes` on the live
 * project (2026-08-28) — same list test-code-labels.test.ts pins, plus
 * ferritin/vitamin_b12 (added to screen_types after that file was written).
 * If a bundle starts using a new code, add it here and to the map.
 */
const CODES_IN_USE = [
  "abdominal_ultrasound",
  "blood_group",
  "breast_imaging",
  "cervical_smear",
  "ecg_resting",
  "fbc",
  "ferritin",
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
  "vitamin_b12",
];

describe("test preparation", () => {
  it("covers every code the live panel bundles actually use", () => {
    const missing = CODES_IN_USE.filter((code) => !TEST_PREPARATION[code]);
    expect(missing).toEqual([]);
  });

  it("never leaves instructions blank — silence would read as a missing answer, not 'no prep needed'", () => {
    for (const prep of Object.values(TEST_PREPARATION)) {
      expect(prep.instructions.trim().length).toBeGreaterThan(0);
      expect(prep.specimenType.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not assume every blood test requires fasting (spec §14.8)", () => {
    // hba1c is a blood test that explicitly does NOT require fasting.
    expect(TEST_PREPARATION.hba1c.instructions).toMatch(/no fasting/i);
    // ogtt_fpg is a blood test that DOES require fasting.
    expect(TEST_PREPARATION.ogtt_fpg.instructions).toMatch(/fasting required/i);
  });

  it("skips an unmapped code rather than inventing a preparation requirement", () => {
    expect(testPreparationForCodes(["not_a_real_code"])).toEqual([]);
  });

  it("de-duplicates identical preparation entries across a multi-test bundle", () => {
    // fbc and ferritin are both "venous blood sample / no fasting needed".
    const result = testPreparationForCodes(["fbc", "ferritin", "ogtt_fpg"]);
    expect(result).toHaveLength(2);
    expect(result[0].instructions).toMatch(/no fasting/i);
    expect(result[1].instructions).toMatch(/fasting required/i);
  });
});
