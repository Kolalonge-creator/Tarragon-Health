import { describe, expect, it } from "@jest/globals";
import { symptomLogSchema } from "./symptoms";

describe("symptomLogSchema", () => {
  const valid = { symptom_type: "pain", severity: "5" };

  it("accepts a valid symptom log", () => {
    expect(symptomLogSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an optional description", () => {
    expect(
      symptomLogSchema.safeParse({ ...valid, description: "worse after exercise" }).success
    ).toBe(true);
  });

  it("rejects an unknown symptom_type", () => {
    expect(
      symptomLogSchema.safeParse({ ...valid, symptom_type: "headache" }).success
    ).toBe(false);
  });

  it("rejects severity below 1", () => {
    expect(symptomLogSchema.safeParse({ ...valid, severity: "0" }).success).toBe(false);
  });

  it("rejects severity above 10", () => {
    expect(symptomLogSchema.safeParse({ ...valid, severity: "11" }).success).toBe(false);
  });

  it("rejects a non-integer severity", () => {
    expect(symptomLogSchema.safeParse({ ...valid, severity: "5.5" }).success).toBe(false);
  });
});
