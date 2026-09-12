/**
 * Plain-language names for the test codes carried in `panel_bundles.test_codes`.
 *
 * Those codes are database identifiers — `hba1c`, `lft`, `kft`, `tft`,
 * `urine_acr`, `ogtt_fpg` — and the patient lab catalogue was printing them
 * verbatim, so a Nigerian patient deciding whether to book a screen read
 * "Includes: hba1c, lipid_panel, fbc, lft, kft, tft, urinalysis, hiv, hep_b,
 * hep_c, blood_group, sickle_cell_genotype, urine_acr, ogtt_fpg, ecg_resting,
 * fit, psa". The API route that generates the printable lab request already
 * refuses to do this, and says so in its own comment ("a lab reading 'hba1c'
 * is fine, a patient reading it is not") — the on-screen catalogue simply
 * never got the same treatment.
 *
 * Why a static map rather than reading `lab_tests.name`: that table covers 18
 * of the 22 codes actually used by bundles (no abdominal_ultrasound,
 * breast_imaging, fit or prostate_ultrasound), carries one row per
 * organisation so the same code returns duplicates, and its names are written
 * for a laboratory rather than a patient ("Urine ACR", "OGTT / Fasting Plasma
 * Glucose"). This is patient-facing copy, so it belongs in code next to the
 * brand-voice rules that govern it, not in per-tenant data.
 *
 * Names keep the familiar abbreviation in brackets where a patient is likely
 * to see it on the lab's own printout, so the two can be matched up.
 */
export const TEST_CODE_LABELS: Readonly<Record<string, string>> = {
  abdominal_ultrasound: "Abdominal ultrasound scan",
  blood_group: "Blood group and rhesus",
  breast_imaging: "Breast scan",
  cervical_smear: "Cervical smear",
  ecg_resting: "Heart tracing (12-lead ECG)",
  fbc: "Full blood count",
  fit: "Bowel screening test (FIT)",
  hba1c: "Average blood sugar (HbA1c)",
  hep_b: "Hepatitis B",
  hep_c: "Hepatitis C",
  hiv: "HIV test",
  kft: "Kidney function",
  lft: "Liver function",
  lipid_panel: "Cholesterol panel",
  ogtt_fpg: "Blood sugar tolerance test",
  prostate_ultrasound: "Prostate ultrasound scan",
  psa: "Prostate check (PSA)",
  sickle_cell_genotype: "Genotype (AA/AS/SS)",
  syphilis: "Syphilis test",
  tft: "Thyroid function",
  tsh: "TSH (thyroid stimulating hormone)",
  free_t4: "Free T4 (thyroid hormone)",
  urinalysis: "Urine test",
  urine_acr: "Urine protein check (ACR)",
};

/**
 * A patient-readable name for one test code. An unmapped code falls back to
 * de-snake-casing rather than printing the raw identifier, so a code added to
 * a bundle before it is added here degrades to "Urine Acr" rather than
 * "urine_acr" — still imperfect, never machine-looking.
 */
export function testCodeLabel(code: string): string {
  const known = TEST_CODE_LABELS[code];
  if (known) return known;
  return code
    .split("_")
    .filter(Boolean)
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/** Labels for a bundle's codes, de-duplicated, in the bundle's own order. */
export function testCodeLabels(codes: readonly string[]): string[] {
  return Array.from(new Set(codes.map(testCodeLabel)));
}

/**
 * Value a patient picks when they don't know, or their result doesn't match,
 * any of the listed test types. Never written to `lab_result_documents.test_code`
 * — selecting it is treated the same as not picking anything, so it can't be
 * mistaken downstream for a real test code.
 */
export const OTHER_TEST_TYPE_VALUE = "other";

/**
 * The test types offered when a patient uploads a result with no lab_order_id
 * to scope it to (so there's no already-known test_code) — the "upload a
 * result you already have" / "upload any result" surfaces, as opposed to the
 * per-test checklist against an open order, which already knows the code.
 *
 * A deliberate subset of TEST_CODE_LABELS: excludes ecg_resting (its own
 * dedicated EcgReportUpload flow) and the imaging scans (abdominal/breast/
 * prostate ultrasound) — a patient photographing a printed lab report is
 * never uploading a scan through this picker.
 */
const RESULT_DOCUMENT_TEST_CODES = [
  "fbc",
  "lipid_panel",
  "hba1c",
  "ogtt_fpg",
  "lft",
  "kft",
  "tft",
  "tsh",
  "free_t4",
  "urinalysis",
  "urine_acr",
  "blood_group",
  "sickle_cell_genotype",
  "hiv",
  "hep_b",
  "hep_c",
  "syphilis",
  "psa",
  "fit",
  "cervical_smear",
] as const;

export interface TestTypeOption {
  value: string;
  label: string;
}

/** Dropdown options for a loose result-document upload, in a stable,
 * patient-sensible order, with the catch-all always last. */
export const RESULT_DOCUMENT_TEST_TYPE_OPTIONS: TestTypeOption[] = [
  ...RESULT_DOCUMENT_TEST_CODES.map((code) => ({
    value: code,
    label: testCodeLabel(code),
  })),
  { value: OTHER_TEST_TYPE_VALUE, label: "Something else / not sure" },
];
