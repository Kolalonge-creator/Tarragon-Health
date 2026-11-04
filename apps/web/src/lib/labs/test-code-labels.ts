// The labels themselves live in @tarragon/shared so the web and the phone use one list (Care Circle mobile parity, 2026-11-04).
import { testCodeLabel } from "@tarragon/shared";

export { TEST_CODE_LABELS, testCodeLabel, testCodeLabels } from "@tarragon/shared";

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
