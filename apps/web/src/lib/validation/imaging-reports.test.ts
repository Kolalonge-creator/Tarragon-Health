import { randomUUID } from "crypto";
import { describe, expect, it } from "@jest/globals";
import { createIncidentalFindingSchema, fileImagingReportSchema } from "./imaging-reports";

// zod v4's .uuid() enforces the real RFC 4122 version/variant nibbles, so a
// hand-typed placeholder like "...-0000-000000000001" fails as malformed —
// only a genuinely valid UUID (or the all-zeros/all-f's specials) passes.
const imagingOrderId = randomUUID();
const imagingReportId = randomUUID();

const BASE_VALID_REPORT = {
  imaging_order_id: imagingOrderId,
  modality: "mri" as const,
  body_region: "Brain",
  study_date: "2026-08-29",
  findings: "2cm enhancing lesion, left temporal lobe.",
  impression: "Findings concerning for a structural lesion.",
};

describe("fileImagingReportSchema", () => {
  it("accepts a normal, non-abnormal report", () => {
    const result = fileImagingReportSchema.safeParse(BASE_VALID_REPORT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_abnormal).toBe(false);
      expect(result.data.urgency).toBe("routine");
    }
  });

  it("accepts an abnormal report with an elevated urgency", () => {
    const result = fileImagingReportSchema.safeParse({
      ...BASE_VALID_REPORT,
      is_abnormal: true,
      urgency: "critical",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an elevated urgency on a non-abnormal report", () => {
    const result = fileImagingReportSchema.safeParse({
      ...BASE_VALID_REPORT,
      is_abnormal: false,
      urgency: "urgent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank findings field", () => {
    const result = fileImagingReportSchema.safeParse({
      ...BASE_VALID_REPORT,
      findings: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown modality", () => {
    const result = fileImagingReportSchema.safeParse({
      ...BASE_VALID_REPORT,
      modality: "pet_scan",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-url pacs_url", () => {
    const result = fileImagingReportSchema.safeParse({
      ...BASE_VALID_REPORT,
      pacs_url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("createIncidentalFindingSchema", () => {
  it("accepts a valid finding", () => {
    const result = createIncidentalFindingSchema.safeParse({
      imaging_report_id: imagingReportId,
      description: "Incidental 8mm pulmonary nodule on scout images.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_urgent).toBe(false);
    }
  });

  it("rejects a blank description", () => {
    const result = createIncidentalFindingSchema.safeParse({
      imaging_report_id: imagingReportId,
      description: "",
    });
    expect(result.success).toBe(false);
  });
});
