import { describe, expect, it } from "@jest/globals";
import { canOfferApproval, ruleSetRowSchema, summariseRules } from "./rule-set-review";

describe("summariseRules", () => {
  it("lists each rule with its outcome, paging and tasks", () => {
    const out = summariseRules({
      rules: [
        { id: "R1", description: "Severe", result: "grade", grade: "red", actions: [{ kind: "page_on_call" }, { kind: "show_emergency_guidance", code: "E" }] },
        { id: "R2", description: "Raised", result: "grade", grade: "amber", actions: [{ kind: "create_task", task: "bp_review", dueMinutes: 1440 }] },
        { id: "R3", description: "Check again", result: "recheck", actions: [] },
        { id: "R4", description: "No grade given", result: "grade", actions: [{ kind: "create_task", task: "silence_check" }, { kind: "create_task" }] },
      ],
    });
    expect(out).toEqual([
      { id: "R1", description: "Severe", outcome: "red", pagesOnCall: true, tasks: [] },
      { id: "R2", description: "Raised", outcome: "amber", pagesOnCall: false, tasks: [{ task: "bp_review", dueMinutes: 1440 }] },
      { id: "R3", description: "Check again", outcome: "repeat reading", pagesOnCall: false, tasks: [] },
      { id: "R4", description: "No grade given", outcome: "green", pagesOnCall: false, tasks: [{ task: "silence_check", dueMinutes: null }] },
    ]);
  });

  it("shows a rule that asks about symptoms instead of failing the whole list (the live v2 rule set has one, BP-X1)", () => {
    const out = summariseRules({
      rules: [
        { id: "BP-X1", description: "Ask about symptoms", result: "ask", actions: [{ kind: "ask_symptoms" }] },
        { id: "R2", description: "Raised", result: "grade", grade: "amber", actions: [] },
      ],
    });
    expect(out?.map((r) => r.outcome)).toEqual(["asks about symptoms", "amber"]);
  });

  it("returns null for JSON that is not a rule list", () => {
    expect(summariseRules({})).toBeNull();
    expect(summariseRules(null)).toBeNull();
    expect(summariseRules({ rules: [{ id: 1 }] })).toBeNull();
  });
});

describe("canOfferApproval", () => {
  it("only for a draft with nothing left to confirm", () => {
    expect(canOfferApproval("draft", 0)).toBe(true);
    expect(canOfferApproval("draft", 1)).toBe(false);
    expect(canOfferApproval("approved", 0)).toBe(false);
    expect(canOfferApproval("retired", 0)).toBe(false);
  });
});

describe("ruleSetRowSchema", () => {
  it("accepts a draft row and rejects an unknown status", () => {
    const row = { id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", code: "bp_care_triage", version: 1, status: "draft", approved_by: null, approved_at: null, note: null, rules: {} };
    expect(ruleSetRowSchema.safeParse(row).success).toBe(true);
    expect(ruleSetRowSchema.safeParse({ ...row, status: "live" }).success).toBe(false);
  });
});
