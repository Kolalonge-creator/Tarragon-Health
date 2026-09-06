/**
 * Specimen type and preparation instructions for the test codes carried in
 * `panel_bundles.test_codes` — Laboratory Engine spec §14.4/§14.8.
 *
 * §14.8 is explicit: "The system should not assume all blood tests require
 * fasting." Before this file, the patient lab catalogue said nothing at all
 * about preparation — not a wrong blanket assumption, just silence — so a
 * patient booking a fasting lipid panel and a same-day HbA1c had no way to
 * know only one of the two needed fasting. Every entry below states an
 * explicit answer, never omits one, so "no special preparation" reads as a
 * deliberate answer rather than a gap.
 *
 * Same static-map placement and reasoning as ./test-code-labels.ts (patient-
 * facing copy belongs in code next to the brand-voice rules that govern it,
 * not in per-tenant lab_tests/screen_types data) — kept as a sibling file
 * rather than folded into that one because this is a different shape of
 * content (specimen + instructions vs. a single label) with its own callers.
 */
export interface TestPreparation {
  /** How the specimen is taken, in plain language — not a lab specimen code. */
  specimenType: string;
  /** Always a positive statement, including "no special preparation needed" — never silence. */
  instructions: string;
}

export const TEST_PREPARATION: Readonly<Record<string, TestPreparation>> = {
  hba1c: {
    specimenType: "Blood sample (finger-prick or a small venous draw)",
    instructions: "No fasting needed — eat and drink normally before this test.",
  },
  lipid_panel: {
    specimenType: "Venous blood sample",
    instructions:
      "Best done fasting — nothing but water for 9–12 hours beforehand. Ask your care team about timing before you go.",
  },
  psa: {
    specimenType: "Venous blood sample",
    instructions:
      "No fasting needed. Avoid ejaculation for 24–48 hours beforehand, as it can temporarily raise the result.",
  },
  cervical_smear: {
    specimenType: "Cervical swab, taken during a brief pelvic exam",
    instructions:
      "Avoid intercourse, douching, or vaginal products for 24–48 hours beforehand, and avoid booking during your period if you can.",
  },
  kft: {
    specimenType: "Venous blood sample",
    instructions: "No fasting needed — drink water normally beforehand.",
  },
  urine_acr: {
    specimenType: "Urine sample",
    instructions:
      "No fasting needed. A first-morning sample is preferred if you can manage it, but any sample is fine.",
  },
  blood_group: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  sickle_cell_genotype: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  hep_b: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  hep_c: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  hiv: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  syphilis: {
    specimenType: "Venous blood sample",
    instructions: "No fasting or special preparation needed.",
  },
  fbc: {
    specimenType: "Venous blood sample",
    instructions: "No fasting needed.",
  },
  lft: {
    specimenType: "Venous blood sample",
    instructions: "No fasting needed, though your care team may ask you to avoid alcohol for 24 hours beforehand.",
  },
  tft: {
    specimenType: "Venous blood sample",
    instructions:
      "No fasting needed. If you take thyroid medication, ask your care team whether to take this test before your dose.",
  },
  urinalysis: {
    specimenType: "Urine sample",
    instructions: "No fasting needed. A first-morning sample is preferred if you can manage it.",
  },
  ogtt_fpg: {
    specimenType: "Venous blood sample, taken more than once a few hours apart",
    instructions:
      "Fasting required — nothing but water for 8–12 hours beforehand. Usually done first thing in the morning.",
  },
  ecg_resting: {
    specimenType: "No sample — sticky sensors are placed on your chest and limbs to record your heart's rhythm",
    instructions: "No fasting needed. Wear something that makes it easy to access your chest.",
  },
  fit: {
    specimenType: "Small stool sample, collected at home with a kit",
    instructions: "No fasting or dietary changes needed — just follow the kit's own instructions for timing and storage.",
  },
  abdominal_ultrasound: {
    specimenType: "No sample — an ultrasound scan of your abdomen",
    instructions:
      "Usually needs 6–8 hours fasting beforehand so the images come out clear. Confirm timing with the lab or imaging centre when you book.",
  },
  breast_imaging: {
    specimenType: "No sample — an ultrasound or mammogram scan",
    instructions: "No fasting needed. Avoid deodorant, powder, or lotion on your chest or underarms on the day.",
  },
  prostate_ultrasound: {
    specimenType: "No sample — an ultrasound scan",
    instructions: "You may be asked to arrive with a full bladder. Confirm with the lab or imaging centre when you book.",
  },
  ferritin: {
    specimenType: "Venous blood sample",
    instructions: "No fasting needed.",
  },
  vitamin_b12: {
    specimenType: "Venous blood sample",
    instructions: "No fasting needed.",
  },
};

/**
 * Preparation info for a bundle's codes, deduplicated by (specimenType,
 * instructions) — a bundle of several same-prep blood tests (e.g. HbA1c +
 * FBC) shows one line, not one per code. An unmapped code is skipped rather
 * than guessed at: silence for a code we don't have data for is honest,
 * inventing a fasting requirement is not.
 */
export function testPreparationForCodes(codes: readonly string[]): TestPreparation[] {
  const seen = new Set<string>();
  const result: TestPreparation[] = [];
  for (const code of codes) {
    const prep = TEST_PREPARATION[code];
    if (!prep) continue;
    const key = `${prep.specimenType} ${prep.instructions}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(prep);
  }
  return result;
}
