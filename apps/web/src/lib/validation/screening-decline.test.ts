import { describe, expect, it } from "@jest/globals";
import { declineScreeningSchema, screeningStateSchema } from "./screening-decline";

const id = "00000000-0000-4000-8000-000000000001";

describe("screeningStateSchema", () => {
  it("accepts a declined or not applicable item with a reason code and a note", () => {
    expect(screeningStateSchema.safeParse({ schedule_id: id, state: "declined", reason_code: "cost", note: "Cannot afford it now" }).success).toBe(true);
    expect(screeningStateSchema.safeParse({ schedule_id: id, state: "not_applicable", reason_code: "medical_reason", note: "Had a hysterectomy" }).success).toBe(true);
  });
  it("refuses a missing or blank note (the database refuses it too)", () => {
    expect(screeningStateSchema.safeParse({ schedule_id: id, state: "declined", reason_code: "other", note: "   " }).success).toBe(false);
  });
  it("refuses a state that is not declined or not applicable and an unknown reason code", () => {
    expect(screeningStateSchema.safeParse({ schedule_id: id, state: "completed", reason_code: "other", note: "x" }).success).toBe(false);
    expect(screeningStateSchema.safeParse({ schedule_id: id, state: "declined", reason_code: "made_up", note: "x" }).success).toBe(false);
  });
  it("keeps the older decline shape working", () => {
    expect(declineScreeningSchema.safeParse({ schedule_id: id, reason: "Already had this elsewhere" }).success).toBe(true);
    expect(declineScreeningSchema.safeParse({ schedule_id: id, reason: "" }).success).toBe(false);
  });
});
