/**
 * Context (age, sex, pregnancy, conditions, medicines, readings) can only TIGHTEN urgency (spec 12.2, 12.6).
 * The property: supplying more of the record never lowers a result, whatever the entries say.
 */
import { describe, it, expect } from "@jest/globals";
import { TRIAGE_CATEGORIES, categoryAtLeast, type SymptomCapture, type TriageCategory } from "../types/index";
import { applyContextTightening, contextTighteningConfigSchema, EMPTY_CONTEXT, READING_KEYS, type ClinicalContext } from "./context-tightening";

const capture = (p: Partial<SymptomCapture> = {}): SymptomCapture => ({
  presentingComplaintKey: "headache",
  onset: "gradual",
  severity: 6,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: "test_entry",
  label: "Test",
  provenance: { source: "unit test", note: "synthetic" },
  status: "signed_off",
  clinical_sign_off: { by: "Test CMO", at: "2026-10-07" },
  applies_when: { pregnant: true },
  minimum_category: "urgent",
  ...over,
});

/** Small deterministic PRNG so the property test is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function randomEntry(r: () => number, i: number) {
  const when: Record<string, unknown> = {};
  if (r() < 0.4) when.age_min = Math.floor(r() * 60);
  if (r() < 0.4) when.age_max = 20 + Math.floor(r() * 80);
  if (r() < 0.3) when.sex = pick(r, ["female", "male"] as const);
  if (r() < 0.3) when.pregnant = true;
  if (r() < 0.3) when.any_condition = [pick(r, ["hypertension", "diabetes", "asthma"])];
  if (r() < 0.3) when.any_medicine = [pick(r, ["warfarin", "insulin", "metformin"])];
  if (r() < 0.3) when.reading_at_least = { key: pick(r, READING_KEYS), value: Math.floor(r() * 150) };
  if (r() < 0.3) when.reading_at_most = { key: pick(r, READING_KEYS), value: Math.floor(r() * 150) };
  if (r() < 0.2) when.min_severity = 1 + Math.floor(r() * 9);
  return entry({ id: `e${i}`, applies_when: when, minimum_category: pick(r, TRIAGE_CATEGORIES), status: r() < 0.8 ? "signed_off" : "draft" });
}

function randomContext(r: () => number): ClinicalContext {
  const readings: ClinicalContext["readings"] = {};
  for (const k of READING_KEYS) if (r() < 0.5) readings[k] = Math.floor(r() * 200);
  return {
    ageYears: r() < 0.7 ? Math.floor(r() * 90) : null,
    sex: r() < 0.7 ? pick(r, ["female", "male"] as const) : null,
    pregnant: r() < 0.5 ? r() < 0.5 : null,
    conditions: ["hypertension", "diabetes", "asthma"].filter(() => r() < 0.4),
    medicines: ["warfarin", "insulin", "metformin"].filter(() => r() < 0.4),
    readings,
  };
}

/** `more` knows everything `less` knows, and possibly more. */
function superset(r: () => number, less: ClinicalContext): ClinicalContext {
  const extra = randomContext(r);
  const readings = { ...extra.readings, ...less.readings };
  return {
    ageYears: less.ageYears ?? extra.ageYears,
    sex: less.sex ?? extra.sex,
    pregnant: less.pregnant ?? extra.pregnant,
    conditions: [...new Set([...less.conditions, ...extra.conditions])],
    medicines: [...new Set([...less.medicines, ...extra.medicines])],
    readings,
  };
}

describe("context tightening can only raise a category", () => {
  it("a signed pregnancy entry raises a headache to urgent only for a pregnant person", () => {
    const cfg = { entries: [entry()] };
    expect(applyContextTightening("routine", { ...EMPTY_CONTEXT, pregnant: true }, capture(), cfg).category).toBe("urgent");
    expect(applyContextTightening("routine", { ...EMPTY_CONTEXT, pregnant: false }, capture(), cfg).category).toBe("routine");
    expect(applyContextTightening("routine", EMPTY_CONTEXT, capture(), cfg).category).toBe("routine");
    // ticking "I am pregnant" inside this check counts too
    expect(applyContextTightening("routine", EMPTY_CONTEXT, capture({ relevantHistory: ["pregnant"] }), cfg).category).toBe("urgent");
  });

  it("never lowers: every starting category against every minimum, signed or not", () => {
    for (const start of TRIAGE_CATEGORIES) {
      for (const min of TRIAGE_CATEGORIES) {
        for (const status of ["signed_off", "draft"] as const) {
          const r = applyContextTightening(start, { ...EMPTY_CONTEXT, pregnant: true }, capture(), { entries: [entry({ minimum_category: min, status })] });
          expect(categoryAtLeast(r.category, start)).toBe(true);
        }
      }
    }
  });

  it("PROPERTY: extra inputs never lower urgency (3000 random configs, contexts and supersets)", () => {
    const r = rng(20261007);
    for (let n = 0; n < 3000; n++) {
      const cfg = { entries: Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => randomEntry(r, i)) };
      const start = pick(r, TRIAGE_CATEGORIES) as TriageCategory;
      const less = randomContext(r);
      const more = superset(r, less);
      const cap = capture({ severity: 1 + Math.floor(r() * 10), relevantHistory: r() < 0.2 ? ["pregnant"] : [] });
      const a = applyContextTightening(start, less, cap, cfg).category;
      const b = applyContextTightening(start, more, cap, cfg).category;
      expect(categoryAtLeast(a, start)).toBe(true);
      expect(categoryAtLeast(b, a)).toBe(true);
    }
  });

  it("a draft entry, or one without a recorded sign-off, does nothing", () => {
    const ctx = { ...EMPTY_CONTEXT, pregnant: true };
    expect(applyContextTightening("routine", ctx, capture(), { entries: [entry({ status: "draft" })] }).category).toBe("routine");
    expect(applyContextTightening("routine", ctx, capture(), { entries: [entry({ clinical_sign_off: null })] }).category).toBe("routine");
  });

  it("a malformed config applies nothing, and the schema is strict (no way to set or lower a category)", () => {
    const ctx = { ...EMPTY_CONTEXT, pregnant: true };
    expect(applyContextTightening("routine", ctx, capture(), { entries: [entry({ set_category: "self_management" })] }).category).toBe("routine");
    expect(applyContextTightening("routine", ctx, capture(), "nonsense").category).toBe("routine");
    expect(contextTighteningConfigSchema.safeParse({ entries: [entry({ category: "self_management" })] }).success).toBe(false);
  });

  it("matches a reading threshold written in config, never one written in code", () => {
    const cfg = { entries: [entry({ applies_when: { reading_at_most: { key: "spo2_pct", value: 94 } }, minimum_category: "urgent" })] };
    expect(applyContextTightening("routine", { ...EMPTY_CONTEXT, readings: { spo2_pct: 93 } }, capture(), cfg).category).toBe("urgent");
    expect(applyContextTightening("routine", { ...EMPTY_CONTEXT, readings: { spo2_pct: 97 } }, capture(), cfg).category).toBe("routine");
    expect(applyContextTightening("routine", EMPTY_CONTEXT, capture(), cfg).category).toBe("routine");
  });

  it("reports which kinds of input were present, never their values", () => {
    const r = applyContextTightening("routine", { ...EMPTY_CONTEXT, ageYears: 30, medicines: ["warfarin"] }, capture(), { entries: [] });
    expect(r.inputsPresent).toEqual(["age", "medicines"]);
  });
});
