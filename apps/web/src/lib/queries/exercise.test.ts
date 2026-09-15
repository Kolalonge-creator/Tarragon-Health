import { clearsForModerate, clearsForVigorous } from "./exercise";
import type { ExerciseReadinessScreen } from "./exercise";

function screen(overrides: Partial<ExerciseReadinessScreen>): ExerciseReadinessScreen {
  return {
    id: "screen-1",
    organisation_id: "org",
    patient_id: "patient",
    chest_pain: false,
    dizziness_or_balance: false,
    joint_bone_problem: false,
    doctor_advised_limit: false,
    heart_or_bp_condition: false,
    other_concern: null,
    any_flag: false,
    reviewed_by: null,
    reviewed_at: null,
    cleared_for_intensive: false,
    created_at: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

describe("clearsForModerate", () => {
  it("is false with no screen on file", () => {
    expect(clearsForModerate(null)).toBe(false);
    expect(clearsForModerate(undefined)).toBe(false);
  });

  it("is true for a clean screen (no flags)", () => {
    expect(clearsForModerate(screen({ any_flag: false }))).toBe(true);
  });

  it("is false for a flagged screen without clinician clearance", () => {
    expect(clearsForModerate(screen({ any_flag: true, cleared_for_intensive: false }))).toBe(false);
  });

  it("is true for a flagged screen once a clinician clears it", () => {
    expect(clearsForModerate(screen({ any_flag: true, cleared_for_intensive: true }))).toBe(true);
  });
});

describe("clearsForVigorous", () => {
  it("always requires explicit clinician clearance, flagged or not", () => {
    expect(clearsForVigorous(screen({ any_flag: false, cleared_for_intensive: false }))).toBe(false);
    expect(clearsForVigorous(screen({ any_flag: false, cleared_for_intensive: true }))).toBe(true);
    expect(clearsForVigorous(null)).toBe(false);
  });
});
