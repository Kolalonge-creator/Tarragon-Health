import { deferRules, deferScreeningSchema, DEFER_REASON_LABELS, BASELINE_ITEM_LABELS } from "./preventive-plan";
import { baselineSubmitError, deferError, parseMyPreventiveBaseline } from "@/lib/queries/preventive-plan";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));

const ID = "22222222-2222-4222-8222-222222222222";

describe("defer a screening test (T2-12)", () => {
  it("reads its limits from the versioned setting, and every reason has a label", () => {
    const r = deferRules();
    expect(r.maxDaysAhead).toBe(90);
    for (const c of r.reasonCodes) expect(DEFER_REASON_LABELS[c]).toBeDefined();
  });

  it("needs a later date within the limit, a known reason, and a note for 'other'", () => {
    const s = deferScreeningSchema("2026-11-04", "2026-11-01");
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-20", reason_code: "travelling" }).success).toBe(true);
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-04", reason_code: "travelling" }).success).toBe(false);
    expect(s.safeParse({ schedule_id: ID, new_due: "2027-06-01", reason_code: "travelling" }).success).toBe(false);
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-20", reason_code: "because" }).success).toBe(false);
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-20", reason_code: "other" }).success).toBe(false);
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-20", reason_code: "other", note: "Exams this month" }).success).toBe(true);
  });

  it("a future due date must itself be passed", () => {
    const s = deferScreeningSchema("2026-11-04", "2026-12-01");
    expect(s.safeParse({ schedule_id: ID, new_due: "2026-11-20", reason_code: "cost" }).success).toBe(false);
  });

  it("explains the database's refusals plainly", () => {
    expect(deferError("P0001: defer_limit_reached: ask your care team")).toMatch(/care team can move it/);
    expect(baselineSubmitError("members_only: x")).toMatch(/part of Membership/);
    expect(baselineSubmitError("baseline_incomplete: waist")).toMatch(/still missing/);
  });
});

describe("baseline items", () => {
  it("has a label for every code the database returns", () => {
    for (const c of ["risk_questionnaire", "blood_pressure", "weight", "height", "waist", "medical_history", "medicines", "family_history", "previous_tests"]) {
      expect(BASELINE_ITEM_LABELS[c]).toBeDefined();
    }
  });

  it("parses only a well-formed answer", () => {
    expect(parseMyPreventiveBaseline(null)).toBeNull();
    expect(parseMyPreventiveBaseline({ eligible: true, items: "x", plan: [] })).toBeNull();
    expect(parseMyPreventiveBaseline({ eligible: false, baseline: null, items: [], plan: [] })?.eligible).toBe(false);
  });
});
