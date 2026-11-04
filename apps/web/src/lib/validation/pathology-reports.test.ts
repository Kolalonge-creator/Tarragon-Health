/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { filePathologyReportSchema } from "./pathology-reports";
import { fileImagingReportSchema } from "./imaging-reports";

const IDS = { documentId: "11111111-1111-4111-8111-111111111111", patientId: "22222222-2222-4222-8222-222222222222" };

describe("filing a pathology or cervical result as printed", () => {
  it("accepts each kind with its result line and drops empty fields", () => {
    const r = filePathologyReportSchema.parse({ ...IDS, report_kind: "cervical_cytology", cytology_category_as_printed: "HSIL", site: "  ", note: "Seen" });
    expect(r.cytology_category_as_printed).toBe("HSIL");
    expect(r.site).toBeUndefined();
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "hpv", hpv_result_as_printed: "positive", note: "x" }).success).toBe(true);
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "histopathology", diagnosis_as_printed: "Benign naevus", note: "x", reported_on: "" }).success).toBe(true);
  });

  it("refuses a result without its result line, or without a review note", () => {
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "histopathology", specimen: "Skin", note: "x" }).success).toBe(false);
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "hpv", note: "x" }).success).toBe(false);
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "cervical_cytology", cytology_category_as_printed: "NILM", note: " " }).success).toBe(false);
  });

  it("refuses an HPV result outside what a laboratory prints", () => {
    expect(filePathologyReportSchema.safeParse({ ...IDS, report_kind: "hpv", hpv_result_as_printed: "high risk", note: "x" }).success).toBe(false);
  });
});

describe("mammography fields as printed", () => {
  const base = {
    imaging_order_id: IDS.documentId, body_region: "both breasts", study_date: "2026-11-01", findings: "x", impression: "x",
  };
  it("keeps BI-RADS and density on a breast study", () => {
    expect(fileImagingReportSchema.safeParse({ ...base, modality: "mammography", birads_overall_as_printed: "4A", breast_density_as_printed: "C" }).success).toBe(true);
  });
  it("refuses a value outside the printed scale, or BI-RADS on a chest X-ray", () => {
    expect(fileImagingReportSchema.safeParse({ ...base, modality: "mammography", birads_overall_as_printed: "7" }).success).toBe(false);
    expect(fileImagingReportSchema.safeParse({ ...base, modality: "xray", birads_overall_as_printed: "2" }).success).toBe(false);
  });
});
