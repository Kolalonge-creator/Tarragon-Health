import { describe, expect, it } from "@jest/globals";
import { medicationRefillRuleSchema } from "./medication-refill-rules";

describe("medicationRefillRuleSchema — global", () => {
  const valid = { scope: "global", lead_days: "7" };

  it("accepts a valid rule", () => {
    expect(medicationRefillRuleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects lead_days below 1", () => {
    expect(
      medicationRefillRuleSchema.safeParse({ ...valid, lead_days: "0" }).success
    ).toBe(false);
  });

  it("rejects lead_days above 30", () => {
    expect(
      medicationRefillRuleSchema.safeParse({ ...valid, lead_days: "31" }).success
    ).toBe(false);
  });
});

describe("medicationRefillRuleSchema — patient", () => {
  const valid = { scope: "patient", patient_phone: "+2348011112222", lead_days: "5" };

  it("accepts a valid rule", () => {
    expect(medicationRefillRuleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-E.164 phone", () => {
    expect(
      medicationRefillRuleSchema.safeParse({ ...valid, patient_phone: "08011112222" })
        .success
    ).toBe(false);
  });
});

describe("medicationRefillRuleSchema — discriminated union shape", () => {
  it("rejects a patient-scoped payload missing patient_phone", () => {
    expect(
      medicationRefillRuleSchema.safeParse({ scope: "patient", lead_days: "5" }).success
    ).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(
      medicationRefillRuleSchema.safeParse({ scope: "condition", lead_days: "5" }).success
    ).toBe(false);
  });
});
