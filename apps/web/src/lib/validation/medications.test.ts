import { describe, expect, it } from "@jest/globals";
import { medicationSchema, prescriptionDetailSchema } from "./medications";

describe("medicationSchema", () => {
  const valid = { drug_name: "Lisinopril" };

  it("accepts a minimal valid medication", () => {
    expect(medicationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing drug_name", () => {
    expect(medicationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty drug_name", () => {
    expect(medicationSchema.safeParse({ drug_name: "  " }).success).toBe(false);
  });

  it("accepts well-formed schedule_times", () => {
    expect(
      medicationSchema.safeParse({ ...valid, schedule_times: ["08:00", "20:00"] }).success
    ).toBe(true);
  });

  it("accepts the boundary time 23:59", () => {
    expect(
      medicationSchema.safeParse({ ...valid, schedule_times: ["23:59"] }).success
    ).toBe(true);
  });

  it("rejects a single-digit hour like 8:00", () => {
    expect(
      medicationSchema.safeParse({ ...valid, schedule_times: ["8:00"] }).success
    ).toBe(false);
  });

  it("rejects an invalid hour like 24:00", () => {
    expect(
      medicationSchema.safeParse({ ...valid, schedule_times: ["24:00"] }).success
    ).toBe(false);
  });

  it("rejects more than 6 schedule_times", () => {
    const times = Array.from({ length: 7 }, (_, i) => `0${i}:00`);
    expect(medicationSchema.safeParse({ ...valid, schedule_times: times }).success).toBe(
      false
    );
  });

  it("defaults schedule_times to an empty array when omitted", () => {
    const result = medicationSchema.safeParse(valid);
    expect(result.success && result.data.schedule_times).toEqual([]);
  });

  it("rejects an invalid refill_date", () => {
    expect(
      medicationSchema.safeParse({ ...valid, refill_date: "not-a-date" }).success
    ).toBe(false);
  });
});

describe("prescriptionDetailSchema", () => {
  it("accepts a quantity and a positive whole number of days", () => {
    expect(prescriptionDetailSchema.safeParse({ quantity: " 30 tablets ", duration_days: "30" })).toMatchObject({
      success: true,
      data: { quantity: "30 tablets", duration_days: 30 },
    });
  });
  it.each([
    [{ quantity: "", duration_days: "30" }, /quantity/i],
    [{ quantity: "   ", duration_days: "30" }, /quantity/i],
    [{ quantity: "30 tablets", duration_days: "" }, /days/i],
    [{ quantity: "30 tablets", duration_days: "0" }, /days/i],
    [{ quantity: "30 tablets", duration_days: "-5" }, /days/i],
    [{ quantity: "30 tablets", duration_days: "2.5" }, /whole number/i],
    [{ quantity: "30 tablets" }, /days/i],
  ])("refuses %j with a readable message", (input, message) => {
    const result = prescriptionDetailSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toMatch(message);
  });
});
