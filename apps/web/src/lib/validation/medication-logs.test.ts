import { describe, expect, it } from "@jest/globals";
import { medicationLogSchema } from "./medication-logs";

describe("medicationLogSchema", () => {
  const validFreeform = {
    medication_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    status: "taken",
  };

  it("accepts a freeform log with no scheduled slot", () => {
    expect(medicationLogSchema.safeParse(validFreeform).success).toBe(true);
  });

  it("accepts a scheduled log with both scheduled_time and scheduled_for_date", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        scheduled_time: "08:00",
        scheduled_for_date: "2026-07-06",
      }).success
    ).toBe(true);
  });

  it("rejects scheduled_time without scheduled_for_date", () => {
    expect(
      medicationLogSchema.safeParse({ ...validFreeform, scheduled_time: "08:00" }).success
    ).toBe(false);
  });

  it("rejects scheduled_for_date without scheduled_time", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        scheduled_for_date: "2026-07-06",
      }).success
    ).toBe(false);
  });

  it("rejects an invalid status", () => {
    expect(
      medicationLogSchema.safeParse({ ...validFreeform, status: "forgotten" }).success
    ).toBe(false);
  });

  it("rejects a malformed scheduled_time", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        scheduled_time: "8am",
        scheduled_for_date: "2026-07-06",
      }).success
    ).toBe(false);
  });

  it("rejects a missing medication_id", () => {
    expect(medicationLogSchema.safeParse({ status: "taken" }).success).toBe(false);
  });

  it.each(["unable_to_obtain", "vomited", "side_effect", "other"])(
    "accepts the %s status",
    (status) => {
      expect(medicationLogSchema.safeParse({ ...validFreeform, status }).success).toBe(true);
    }
  );

  it("accepts access_barrier_reason alongside unable_to_obtain", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        status: "unable_to_obtain",
        access_barrier_reason: "cost",
      }).success
    ).toBe(true);
  });

  it("rejects access_barrier_reason on any other status", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        status: "missed",
        access_barrier_reason: "cost",
      }).success
    ).toBe(false);
  });

  it("rejects an invalid access_barrier_reason value", () => {
    expect(
      medicationLogSchema.safeParse({
        ...validFreeform,
        status: "unable_to_obtain",
        access_barrier_reason: "too_expensive",
      }).success
    ).toBe(false);
  });
});
