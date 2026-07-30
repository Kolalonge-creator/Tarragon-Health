import { describe, expect, it } from "@jest/globals";
import {
  setActivityGoalSchema,
  logStepsSchema,
  logWorkoutSchema,
  ACTIVITY_ENTRY_TYPES,
  COMMON_ACTIVITY_NAMES,
} from "./activity";

describe("setActivityGoalSchema", () => {
  it("accepts a positive integer goal", () => {
    expect(setActivityGoalSchema.safeParse({ daily_step_goal: 7500 }).success).toBe(true);
  });

  it("coerces a form-string goal", () => {
    const result = setActivityGoalSchema.safeParse({ daily_step_goal: "10000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.daily_step_goal).toBe(10000);
  });

  it("rejects zero, negative, and non-integer goals", () => {
    expect(setActivityGoalSchema.safeParse({ daily_step_goal: 0 }).success).toBe(false);
    expect(setActivityGoalSchema.safeParse({ daily_step_goal: -100 }).success).toBe(false);
    expect(setActivityGoalSchema.safeParse({ daily_step_goal: 100.5 }).success).toBe(false);
  });

  it("rejects a goal above the 100,000 ceiling", () => {
    expect(setActivityGoalSchema.safeParse({ daily_step_goal: 100001 }).success).toBe(false);
  });
});

describe("logStepsSchema", () => {
  it("accepts zero steps (a real, honest 'logged nothing today' entry)", () => {
    expect(logStepsSchema.safeParse({ step_count: 0 }).success).toBe(true);
  });

  it("accepts a typical step count", () => {
    expect(logStepsSchema.safeParse({ step_count: 8342 }).success).toBe(true);
  });

  it("rejects a negative step count", () => {
    expect(logStepsSchema.safeParse({ step_count: -1 }).success).toBe(false);
  });

  it("rejects a non-integer step count", () => {
    expect(logStepsSchema.safeParse({ step_count: 100.5 }).success).toBe(false);
  });

  it("rejects a step count above the 200,000 ceiling", () => {
    expect(logStepsSchema.safeParse({ step_count: 200001 }).success).toBe(false);
  });

  it("coerces a form-string step count", () => {
    const result = logStepsSchema.safeParse({ step_count: "6000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.step_count).toBe(6000);
  });
});

describe("logWorkoutSchema", () => {
  it("accepts a valid workout with a note", () => {
    const result = logWorkoutSchema.safeParse({
      activity_name: "Outdoor Walk",
      duration_minutes: 30,
      note: "Felt good today",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a workout with no note (nullish)", () => {
    expect(
      logWorkoutSchema.safeParse({ activity_name: "Yoga", duration_minutes: 20 }).success
    ).toBe(true);
    expect(
      logWorkoutSchema.safeParse({ activity_name: "Yoga", duration_minutes: 20, note: null })
        .success
    ).toBe(true);
  });

  it("trims and rejects a blank activity name", () => {
    expect(
      logWorkoutSchema.safeParse({ activity_name: "   ", duration_minutes: 20 }).success
    ).toBe(false);
  });

  it("rejects an activity name over 80 characters", () => {
    const result = logWorkoutSchema.safeParse({
      activity_name: "a".repeat(81),
      duration_minutes: 20,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative duration — a workout without a name is a steps entry instead", () => {
    expect(
      logWorkoutSchema.safeParse({ activity_name: "Run", duration_minutes: 0 }).success
    ).toBe(false);
    expect(
      logWorkoutSchema.safeParse({ activity_name: "Run", duration_minutes: -10 }).success
    ).toBe(false);
  });

  it("rejects a duration above the 1000-minute ceiling", () => {
    expect(
      logWorkoutSchema.safeParse({ activity_name: "Run", duration_minutes: 1001 }).success
    ).toBe(false);
  });

  it("rejects a note over 300 characters", () => {
    const result = logWorkoutSchema.safeParse({
      activity_name: "Run",
      duration_minutes: 30,
      note: "x".repeat(301),
    });
    expect(result.success).toBe(false);
  });
});

describe("ACTIVITY_ENTRY_TYPES / COMMON_ACTIVITY_NAMES", () => {
  it("carries exactly the steps/workout shape the DB enum + CHECK constraint expect", () => {
    expect(ACTIVITY_ENTRY_TYPES).toEqual(["steps", "workout"]);
  });

  it("seeds a non-empty picker of common workout names", () => {
    expect(COMMON_ACTIVITY_NAMES.length).toBeGreaterThan(0);
    expect(COMMON_ACTIVITY_NAMES).toContain("Other");
  });
});
