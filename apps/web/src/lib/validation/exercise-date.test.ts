import { isRealCalendarDate, logExerciseSessionSchema } from "./exercise";

describe("isRealCalendarDate", () => {
  it("accepts real dates including a leap day", () => {
    expect(isRealCalendarDate("2026-10-29")).toBe(true);
    expect(isRealCalendarDate("2028-02-29")).toBe(true);
  });
  it("rejects dates that match the shape but do not exist", () => {
    for (const d of ["2026-02-31", "2026-13-01", "2026-00-10", "2027-02-29", "2026-04-31", "29/10/2026", ""]) {
      expect(isRealCalendarDate(d)).toBe(false);
    }
  });
});

describe("logExerciseSessionSchema performed_on", () => {
  const base = { duration_minutes: "20", kind: "walking" };
  it("gives the patient a plain message for an impossible date, not a database error", () => {
    const r = logExerciseSessionSchema.safeParse({ ...base, performed_on: "2026-02-31" });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]?.message).toBe("Choose the day you exercised");
  });
  it("accepts a real date", () => {
    expect(logExerciseSessionSchema.safeParse({ ...base, performed_on: "2026-10-29" }).success).toBe(true);
  });
});
