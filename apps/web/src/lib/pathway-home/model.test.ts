import { baselineLines, careTeamNotes, currentMilestones, describeMilestone, isClinicianReview, isPaused, parseGoals, summariseMilestones } from "./model";

const now = new Date("2026-10-22T10:00:00Z");

describe("describeMilestone", () => {
  it("maps the fixed codes", () => {
    expect(describeMilestone("baseline").key).toBe("pathway.milestone.baseline");
    expect(describeMilestone("three_month_review").key).toBe("pathway.milestone.three_month_review");
  });
  it("maps a dated scheduled test to the check type", () => {
    expect(describeMilestone("test_eye_20261201")).toEqual({ key: "pathway.milestone.test", params: { check: "pathway.check.eye" } });
    expect(describeMilestone("test_kidney_20270101").params?.check).toBe("pathway.check.kidney");
  });
  it("never invents a label for an unknown code or check", () => {
    expect(describeMilestone("test_dental_20261201").key).toBe("pathway.milestone.other");
    expect(describeMilestone("surprise").key).toBe("pathway.milestone.other");
  });
  it("treats clinician_review_* as a clinician review", () => {
    expect(describeMilestone("clinician_review_2026-11").key).toBe("pathway.milestone.clinician_review");
    expect(isClinicianReview("clinician_review_x")).toBe(true);
    expect(isClinicianReview("test_eye_20261201")).toBe(false);
  });
});

describe("summariseMilestones", () => {
  const rows = [
    { code: "six_month_review", due_at: "2027-04-01T00:00:00Z", met_at: null },
    { code: "baseline", due_at: "2026-10-01T00:00:00Z", met_at: "2026-10-01T00:00:00Z" },
    { code: "first_review", due_at: "2026-11-01T00:00:00Z", met_at: null },
  ];
  it("picks the soonest open milestone as next", () => {
    const s = summariseMilestones(rows, now);
    expect(s.next?.code).toBe("first_review");
    expect(s.later.map((r) => r.code)).toEqual(["six_month_review"]);
    expect(s.met.map((r) => r.code)).toEqual(["baseline"]);
    expect(s.nextIsDue).toBe(false);
  });
  it("marks a passed date as due, not as a failure", () => {
    expect(summariseMilestones(rows, new Date("2026-11-02T00:00:00Z")).nextIsDue).toBe(true);
  });
  it("handles no milestones", () => {
    expect(summariseMilestones([], now)).toEqual({ next: null, later: [], met: [], nextIsDue: false });
  });
});

describe("parseGoals and baselineLines", () => {
  it("keeps only well-formed goals", () => {
    expect(parseGoals([{ description: "d", target_value: 7, target_unit: "%" }, { description: 1 }, null, "x"])).toEqual([{ description: "d", target_value: 7, target_unit: "%" }]);
    expect(parseGoals("nope")).toEqual([]);
  });
  it("leaves out a missing reading instead of showing zero", () => {
    expect(baselineLines({ blood_pressure: { systolic: 150, diastolic: 95 }, glucose: null })).toEqual([{ key: "pathway.baseline.bp", params: { systolic: 150, diastolic: 95 } }]);
    expect(baselineLines({})).toEqual([]);
    expect(baselineLines(null)).toEqual([]);
  });
});

describe("careTeamNotes", () => {
  const review = { code: "first_review", due_at: "2026-11-01T00:00:00Z", met_at: null };
  it("always says readings are checked, first, even while paused", () => {
    expect(careTeamNotes({ paused: true, nextReview: null, now })).toEqual(["readings_checked", "paused"]);
  });
  it("says a review is planned or due from the milestone date only", () => {
    expect(careTeamNotes({ paused: false, nextReview: review, now })).toEqual(["readings_checked", "review_planned"]);
    expect(careTeamNotes({ paused: false, nextReview: review, now: new Date("2026-11-05T00:00:00Z") })).toEqual(["readings_checked", "review_due"]);
  });
});

describe("currentMilestones", () => {
  const row = (code: string) => ({ code, due_at: "2026-10-01T00:00:00Z", met_at: null });
  it("keeps only the newest row of each scheduled-test type", () => {
    const out = currentMilestones([row("test_eye_20250101"), row("test_eye_20261201"), row("test_foot_20260301"), row("first_review")]);
    expect(out.map((r) => r.code).sort()).toEqual(["first_review", "test_eye_20261201", "test_foot_20260301"]);
  });
  it("never touches non-test milestones", () => {
    expect(currentMilestones([row("clinician_review_20261001"), row("clinician_review_20260901")])).toHaveLength(2);
  });
});

describe("isPaused", () => {
  const ev = (id: string, action: string, created_at: string) => ({ id, action, created_at });
  it("is paused only when the latest pause-or-resume is a pause", () => {
    expect(isPaused([ev("1", "pause", "2026-10-01T00:00:00Z")])).toBe(true);
    expect(isPaused([ev("1", "pause", "2026-10-01T00:00:00Z"), ev("2", "resume", "2026-10-02T00:00:00Z")])).toBe(false);
    expect(isPaused([])).toBe(false);
  });
  it("ignores other lifecycle actions", () => {
    expect(isPaused([ev("1", "pause", "2026-10-01T00:00:00Z"), ev("2", "transfer", "2026-10-03T00:00:00Z")])).toBe(true);
  });
  it("breaks a timestamp tie by id, descending, like the database", () => {
    const t = "2026-10-01T00:00:00Z";
    expect(isPaused([ev("a", "pause", t), ev("b", "resume", t)])).toBe(false);
    expect(isPaused([ev("a", "resume", t), ev("b", "pause", t)])).toBe(true);
  });
});
