import { describe, expect, it } from "@jest/globals";
import {
  medicationAccessCheckinSchema,
  medicationSideEffectReportSchema,
  medicationReminderPreferencesSchema,
} from "./medication-access";

const medicationId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("medicationAccessCheckinSchema", () => {
  it("accepts obtained=yes with no barrier", () => {
    expect(
      medicationAccessCheckinSchema.safeParse({ medication_id: medicationId, obtained: "yes" }).success
    ).toBe(true);
  });

  it("rejects obtained=no with no barrier", () => {
    expect(
      medicationAccessCheckinSchema.safeParse({ medication_id: medicationId, obtained: "no" }).success
    ).toBe(false);
  });

  it("accepts obtained=no with a barrier", () => {
    expect(
      medicationAccessCheckinSchema.safeParse({
        medication_id: medicationId,
        obtained: "no",
        barrier: "too_expensive",
      }).success
    ).toBe(true);
  });

  it("rejects an unknown barrier value", () => {
    expect(
      medicationAccessCheckinSchema.safeParse({
        medication_id: medicationId,
        obtained: "no",
        barrier: "unrecognised",
      }).success
    ).toBe(false);
  });
});

describe("medicationSideEffectReportSchema", () => {
  it("accepts a valid report", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({
        medication_id: medicationId,
        description: "Felt dizzy after taking it",
        severity: "moderate",
      }).success
    ).toBe(true);
  });

  it("rejects an empty description", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({
        medication_id: medicationId,
        description: "",
        severity: "mild",
      }).success
    ).toBe(false);
  });

  it("rejects an invalid severity", () => {
    expect(
      medicationSideEffectReportSchema.safeParse({
        medication_id: medicationId,
        description: "Nausea",
        severity: "extreme",
      }).success
    ).toBe(false);
  });
});

describe("medicationReminderPreferencesSchema", () => {
  it("accepts both booleans", () => {
    expect(
      medicationReminderPreferencesSchema.safeParse({
        dose_reminders_enabled: true,
        missed_dose_prompts_enabled: false,
      }).success
    ).toBe(true);
  });
});
