import {
  lifestyleAssessmentSchema,
  lifestyleGoalSchema,
  lifestyleCheckinResponseSchema,
  lifestyleReviewCompletionSchema,
  LIFESTYLE_DOMAINS,
} from "./lifestyle";

describe("lifestyleAssessmentSchema", () => {
  it("accepts a fully-empty assessment (every field is optional/skippable)", () => {
    expect(lifestyleAssessmentSchema.safeParse({}).success).toBe(true);
  });

  it("accepts values within the DB CHECK ranges", () => {
    const parsed = lifestyleAssessmentSchema.parse({
      activity_minutes_weekly: 150,
      sleep_hours_nightly: 7.5,
      stress_level: 3,
      diet_quality: 4,
      smokes: false,
      alcohol_units_weekly: 6,
      notes: "Feeling ok",
    });
    expect(parsed.stress_level).toBe(3);
    expect(parsed.sleep_hours_nightly).toBe(7.5);
  });

  it("maps the smokes select strings correctly (not coerced truthy)", () => {
    expect(lifestyleAssessmentSchema.parse({ smokes: "false" }).smokes).toBe(false);
    expect(lifestyleAssessmentSchema.parse({ smokes: "true" }).smokes).toBe(true);
  });

  it("rejects out-of-range stress and sleep (mirrors DB constraints)", () => {
    expect(lifestyleAssessmentSchema.safeParse({ stress_level: 6 }).success).toBe(false);
    expect(lifestyleAssessmentSchema.safeParse({ sleep_hours_nightly: 25 }).success).toBe(false);
    expect(lifestyleAssessmentSchema.safeParse({ diet_quality: 0 }).success).toBe(false);
  });
});

describe("lifestyleGoalSchema", () => {
  it("accepts a valid goal in each domain", () => {
    for (const domain of LIFESTYLE_DOMAINS) {
      const res = lifestyleGoalSchema.safeParse({ domain, title: "Walk 20 minutes daily" });
      expect(res.success).toBe(true);
    }
  });

  it("requires a meaningful title", () => {
    expect(lifestyleGoalSchema.safeParse({ domain: "weight", title: "x" }).success).toBe(false);
  });

  it("rejects an unknown domain and a malformed target_date", () => {
    expect(lifestyleGoalSchema.safeParse({ domain: "cardio", title: "Run more" }).success).toBe(false);
    expect(
      lifestyleGoalSchema.safeParse({ domain: "weight", title: "Lose 5kg", target_date: "soon" }).success,
    ).toBe(false);
  });
});

describe("lifestyleCheckinResponseSchema", () => {
  it("requires a non-empty response", () => {
    expect(lifestyleCheckinResponseSchema.safeParse({ response: "" }).success).toBe(false);
    expect(lifestyleCheckinResponseSchema.safeParse({ response: "Going well" }).success).toBe(true);
  });
});

describe("lifestyleReviewCompletionSchema", () => {
  it("allows empty notes and caps very long notes", () => {
    expect(lifestyleReviewCompletionSchema.safeParse({}).success).toBe(true);
    expect(lifestyleReviewCompletionSchema.safeParse({ notes: "x".repeat(2001) }).success).toBe(false);
  });
});
