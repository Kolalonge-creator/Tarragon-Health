/**
 * Prevalence and seasonal risk can only TIGHTEN urgency (spec 12.2, 12.11). The property that matters is proven over every
 * category and every kind of entry: no configuration, however written, lowers a result.
 */
import { describe, it, expect } from "@jest/globals";
import { TRIAGE_CATEGORIES, categoryAtLeast, type SymptomCapture, type TriageCategory } from "../types/index";
import { applyRiskTightening, riskTighteningConfigSchema, type RiskContext } from "./risk-tightening";

const capture = (p: Partial<SymptomCapture> = {}): SymptomCapture => ({
  presentingComplaintKey: "headache",
  onset: "gradual",
  severity: 4,
  associatedSymptoms: ["fever"],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});
const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({ capture: capture(), month: 8, state: "Lagos", ...over });

const entry = (over: Record<string, unknown> = {}) => ({
  id: "test_entry",
  label: "Test",
  provenance: { source: "unit test", note: "synthetic" },
  status: "signed_off",
  clinical_sign_off: { by: "Test CMO", at: "2026-10-07" },
  applies_when: { any_associated_symptom: ["fever"] },
  minimum_category: "urgent",
  ...over,
});

describe("risk tightening can only raise a category", () => {
  it("raises self-care to urgent when a signed entry matches", () => {
    const r = applyRiskTightening("self_management", ctx(), { entries: [entry()] });
    expect(r.category).toBe("urgent");
    expect(r.raisedBy).toEqual(["test_entry"]);
  });

  it("never lowers: every starting category against every minimum, signed or not, matching or not", () => {
    for (const start of TRIAGE_CATEGORIES) {
      for (const min of TRIAGE_CATEGORIES) {
        for (const status of ["signed_off", "draft"] as const) {
          for (const matches of [true, false]) {
            const cfg = { entries: [entry({ minimum_category: min, status, applies_when: matches ? { any_associated_symptom: ["fever"] } : { any_associated_symptom: ["no_such"] } })] };
            const r = applyRiskTightening(start as TriageCategory, ctx(), cfg);
            expect(categoryAtLeast(r.category, start as TriageCategory)).toBe(true);
          }
        }
      }
    }
  });

  it("two entries cannot undo each other: the most urgent minimum wins whatever the order", () => {
    const a = entry({ id: "a", minimum_category: "emergency" });
    const b = entry({ id: "b", minimum_category: "routine" });
    expect(applyRiskTightening("self_management", ctx(), { entries: [a, b] }).category).toBe("emergency");
    expect(applyRiskTightening("self_management", ctx(), { entries: [b, a] }).category).toBe("emergency");
  });

  it("a draft entry, or one without a recorded sign-off, does nothing", () => {
    expect(applyRiskTightening("self_management", ctx(), { entries: [entry({ status: "draft" })] }).category).toBe("self_management");
    expect(applyRiskTightening("self_management", ctx(), { entries: [entry({ clinical_sign_off: null })] }).category).toBe("self_management");
  });

  it("the schema has no way to set or lower a category: an unknown key is refused, and malformed config applies nothing", () => {
    expect(riskTighteningConfigSchema.safeParse({ entries: [{ ...entry(), set_category: "self_management" }] }).success).toBe(false);
    expect(riskTighteningConfigSchema.safeParse({ entries: [entry({ minimum_category: "ignore" })] }).success).toBe(false);
    expect(applyRiskTightening("urgent", ctx(), { entries: [{ ...entry(), set_category: "self_management" }] }).category).toBe("urgent");
    expect(applyRiskTightening("urgent", ctx(), "garbage").category).toBe("urgent");
  });

  it("an empty list in a condition is refused, so 'everywhere' or 'every month' is never written by accident", () => {
    for (const k of ["months", "states", "complaint_keys", "any_associated_symptom", "any_history"]) {
      expect(riskTighteningConfigSchema.safeParse({ entries: [entry({ applies_when: { [k]: [] } })] }).success).toBe(false);
    }
  });

  it("season, state and symptom conditions narrow when an entry applies", () => {
    const seasonal = { entries: [entry({ applies_when: { months: [12, 1, 2], any_associated_symptom: ["fever"] } })] };
    expect(applyRiskTightening("routine", ctx({ month: 1 }), seasonal).category).toBe("urgent");
    expect(applyRiskTightening("routine", ctx({ month: 7 }), seasonal).category).toBe("routine");
    const local = { entries: [entry({ applies_when: { states: ["Edo"] } })] };
    expect(applyRiskTightening("routine", ctx({ state: "Edo" }), local).category).toBe("urgent");
    expect(applyRiskTightening("routine", ctx({ state: "Lagos" }), local).category).toBe("routine");
    // an unknown state is treated as possibly inside: the safe direction
    expect(applyRiskTightening("routine", ctx({ state: null }), local).category).toBe("urgent");
  });
});
