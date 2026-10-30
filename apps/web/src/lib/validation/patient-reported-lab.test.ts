import { describe, expect, it } from "@jest/globals";
import { patientReportedLabSchema } from "./patient-reported-lab";

const ID = "11111111-1111-4111-8111-111111111111";
const ok = { extractionId: ID, reportDate: "2026-10-01", readings: [{ code: "hba1c", value: 6.9, unit: "%" }] };

describe("patientReportedLabSchema", () => {
  it("accepts a normal confirmation", () => {
    expect(patientReportedLabSchema.safeParse(ok).success).toBe(true);
  });
  it("accepts a missing unit", () => {
    expect(patientReportedLabSchema.safeParse({ ...ok, readings: [{ code: "ldl", value: 3.4 }] }).success).toBe(true);
  });
  it.each([
    ["no readings", { ...ok, readings: [] }],
    ["a non-numeric value", { ...ok, readings: [{ code: "hba1c", value: "abc" }] }],
    ["a negative value", { ...ok, readings: [{ code: "hba1c", value: -1 }] }],
    ["an absurd value", { ...ok, readings: [{ code: "hba1c", value: 99_999_999 }] }],
    ["an infinite value", { ...ok, readings: [{ code: "hba1c", value: Infinity }] }],
    ["a bad extraction id", { ...ok, extractionId: "nope" }],
    ["a bad date", { ...ok, reportDate: "01/10/2026" }],
    ["a date before 1990", { ...ok, reportDate: "1980-01-01" }],
    ["more than 60 readings", { ...ok, readings: Array.from({ length: 61 }, (_, i) => ({ code: `a${i}`, value: 1 })) }],
    ["a blank code", { ...ok, readings: [{ code: " ", value: 1 }] }],
  ])("rejects %s", (_name, input) => {
    expect(patientReportedLabSchema.safeParse(input).success).toBe(false);
  });
});
