import { bloodPressureSchema } from "./vitals";

describe("blood pressure cuff type (S12b)", () => {
  const base = { vital_type: "blood_pressure", systolic: 130, diastolic: 80 };
  it("accepts upper_arm, wrist and not_sure, and none", () => {
    for (const cuff of ["upper_arm", "wrist", "not_sure"]) {
      expect(bloodPressureSchema.safeParse({ ...base, cuff_type: cuff }).success).toBe(true);
    }
    expect(bloodPressureSchema.safeParse(base).success).toBe(true);
  });
  it("refuses anything else", () => {
    expect(bloodPressureSchema.safeParse({ ...base, cuff_type: "finger" }).success).toBe(false);
  });
});
