import { describe, expect, it } from "@jest/globals";
import { vitalsReminderRuleSchema } from "./vitals-reminder-rules";

describe("vitalsReminderRuleSchema — global", () => {
  const valid = { scope: "global", frequency_days: "30" };

  it("accepts a valid rule", () => {
    expect(vitalsReminderRuleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects frequency_days below 1", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ ...valid, frequency_days: "0" }).success
    ).toBe(false);
  });

  it("rejects frequency_days above 90", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ ...valid, frequency_days: "91" }).success
    ).toBe(false);
  });
});

describe("vitalsReminderRuleSchema — condition", () => {
  const valid = { scope: "condition", condition: "hypertension", frequency_days: "3" };

  it("accepts a valid rule", () => {
    expect(vitalsReminderRuleSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts diabetes as a condition", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ ...valid, condition: "diabetes" }).success
    ).toBe(true);
  });

  it("rejects a condition outside hypertension/diabetes", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ ...valid, condition: "obesity" }).success
    ).toBe(false);
  });

  it("rejects a missing condition", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ scope: "condition", frequency_days: "3" })
        .success
    ).toBe(false);
  });
});

describe("vitalsReminderRuleSchema — patient", () => {
  const valid = { scope: "patient", patient_phone: "+2348011112222", frequency_days: "7" };

  it("accepts a valid rule", () => {
    expect(vitalsReminderRuleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-E.164 phone", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ ...valid, patient_phone: "08011112222" })
        .success
    ).toBe(false);
  });
});

describe("vitalsReminderRuleSchema — discriminated union shape", () => {
  it("rejects a patient-scoped payload missing patient_phone", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ scope: "patient", frequency_days: "3" }).success
    ).toBe(false);
  });

  it("rejects an unknown scope", () => {
    expect(
      vitalsReminderRuleSchema.safeParse({ scope: "org", frequency_days: "3" }).success
    ).toBe(false);
  });
});
