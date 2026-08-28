import { describe, expect, it } from "@jest/globals";
import {
  medicationSideEffectReportSchema,
  reviewMedicationSideEffectReportSchema,
} from "./medication-side-effects";

describe("medicationSideEffectReportSchema", () => {
  const valid = {
    medication_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    symptom: "Dry cough",
    severity: "moderate",
  };

  it("accepts a minimal valid report", () => {
    expect(medicationSideEffectReportSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing medication_id", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({
        symptom: valid.symptom,
        severity: valid.severity,
      }).success
    ).toBe(false);
  });

  it("rejects an empty symptom", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({ ...valid, symptom: "  " }).success
    ).toBe(false);
  });

  it("rejects an invalid severity", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({ ...valid, severity: "extreme" }).success
    ).toBe(false);
  });

  it("accepts an onset date, duration, and description", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({
        ...valid,
        onset_date: "2026-08-20",
        duration_text: "Started 2 days ago, ongoing",
        description: "Worse at night",
      }).success
    ).toBe(true);
  });

  it("rejects a malformed onset date", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({ ...valid, onset_date: "not-a-date" }).success
    ).toBe(false);
  });
});

describe("reviewMedicationSideEffectReportSchema", () => {
  it("accepts a reviewed status with notes", () => {
    expect(
      reviewMedicationSideEffectReportSchema.safeParse({
        status: "reviewed",
        review_notes: "Advised to stop and switch",
      }).success
    ).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(
      reviewMedicationSideEffectReportSchema.safeParse({ status: "new" }).success
    ).toBe(false);
  });
});
