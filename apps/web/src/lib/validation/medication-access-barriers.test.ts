import { describe, expect, it } from "@jest/globals";
import { medicationAccessBarrierSchema, MEDICATION_ACCESS_BARRIER_REASONS } from "./medication-access-barriers";

describe("medicationAccessBarrierSchema", () => {
  const valid = {
    medication_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    reason: "expensive",
  };

  it("accepts a valid report", () => {
    expect(medicationAccessBarrierSchema.safeParse(valid).success).toBe(true);
  });

  it.each(MEDICATION_ACCESS_BARRIER_REASONS)("accepts the %s reason", (reason) => {
    expect(medicationAccessBarrierSchema.safeParse({ ...valid, reason }).success).toBe(true);
  });

  it("rejects an unknown reason", () => {
    expect(
      medicationAccessBarrierSchema.safeParse({ ...valid, reason: "too_expensive" }).success
    ).toBe(false);
  });

  it("rejects a missing medication_id", () => {
    expect(
      medicationAccessBarrierSchema.safeParse({ reason: "expensive" }).success
    ).toBe(false);
  });

  it("accepts an optional note", () => {
    expect(
      medicationAccessBarrierSchema.safeParse({ ...valid, note: "Prices went up this month" })
        .success
    ).toBe(true);
  });
});
