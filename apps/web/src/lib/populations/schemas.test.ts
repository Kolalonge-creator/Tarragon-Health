import { describe, expect, it } from "@jest/globals";
import {
  populationFiltersSchema,
  populationSummarySchema,
  populationOutcomesSchema,
  campaignEffectivenessSchema,
} from "./schemas";

describe("populationFiltersSchema", () => {
  it("accepts an empty object (no constraint on any axis)", () => {
    expect(populationFiltersSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a well-formed compound filter, same shape as the system registries", () => {
    const result = populationFiltersSchema.safeParse({
      conditions: ["hypertension"],
      risk_levels: ["high", "very_high"],
      control_status: ["uncontrolled"],
      min_age: 40,
      pregnant_only: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognised key so a typo never silently matches everyone", () => {
    const result = populationFiltersSchema.safeParse({ conditon: ["hypertension"] });
    expect(result.success).toBe(false);
  });

  it("rejects a condition value get_population_members() would not recognise", () => {
    const result = populationFiltersSchema.safeParse({ conditions: ["not_a_real_condition"] });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range age", () => {
    expect(populationFiltersSchema.safeParse({ min_age: -1 }).success).toBe(false);
    expect(populationFiltersSchema.safeParse({ max_age: 200 }).success).toBe(false);
  });
});

describe("populationSummarySchema", () => {
  it("parses the shape get_population_summary() returns", () => {
    const result = populationSummarySchema.safeParse({
      total_members: 3,
      risk_distribution: [{ risk_level: "high", patients: 1 }],
      control_status: [{ status: "uncontrolled", patients: 1 }],
      care_gaps: [{ gap_type: "overdue_screening", patients: 1 }],
      engagement: [{ band: "disengaged", patients: 3 }],
    });
    expect(result.success).toBe(true);
  });
});

describe("populationOutcomesSchema", () => {
  it("parses a null rate (no denominator yet) without failing", () => {
    const result = populationOutcomesSchema.safeParse({
      disease_control: [],
      engagement: [],
      screening_completion_rate: null,
      screening_completed: 0,
      screening_total: 0,
      medication_adherence_rate: null,
      medication_checkins_taken: 0,
      medication_checkins_total: 0,
      care_plan_completion_rate: null,
      care_plans_completed: 0,
      care_plans_total: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("campaignEffectivenessSchema", () => {
  it("parses a null population_size for a campaign with no linked population", () => {
    const result = campaignEffectivenessSchema.safeParse({
      invited: 0,
      joined: 0,
      completed: 0,
      declined: 0,
      total_enrolled: 0,
      completion_rate: null,
      population_size: null,
    });
    expect(result.success).toBe(true);
  });
});
