import { minutesLabel, parseWindow, workloadSchema } from "./model";

describe("workload model", () => {
  it("formats minutes, with a dash for no data", () => {
    expect(minutesLabel(null)).toBe("-");
    expect(minutesLabel(0)).toBe("0 min");
    expect(minutesLabel(44.6)).toBe("45 min");
    expect(minutesLabel(60)).toBe("1 h");
    expect(minutesLabel(125)).toBe("2 h 5 min");
  });
  it("only accepts the offered windows", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow(["90"])).toBe(90);
    expect(parseWindow("5; drop table")).toBe(30);
    expect(parseWindow(undefined)).toBe(30);
  });
  it("parses the database answer and refuses a malformed one", () => {
    const row = { clinician_id: "5b0d3a52-6f0e-4a55-9d6e-0d1c1b6c9a11", name: "A", claims: 1, completed: 1, handbacks: 0, median_minutes: 5, p90_minutes: 5, overdue: 0 };
    expect(workloadSchema.safeParse({ days: 30, generated_at: "2026-10-07T10:00:00Z", clinicians: [row] }).success).toBe(true);
    expect(workloadSchema.safeParse({ days: 30, generated_at: "2026-10-07T10:00:00Z", clinicians: [{ ...row, claims: -1 }] }).success).toBe(false);
  });
});
