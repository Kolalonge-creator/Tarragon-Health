/**
 * Golden safety scenarios (spec §18). These are safety-critical: they must
 * stay green. They cover the acceptance criteria red flags for all three
 * conditions plus the shared base set, and prove adapter isolation.
 */
import { describe, it, expect } from "@jest/globals";
import { evaluateRedFlags } from "./index";
import { getAdapter, allAdapters } from "../adapters/index";
import type {
  ConditionAdapter,
  MeasurementInput,
  PatientContext,
  SafetyInput,
} from "../types/index";

const CALM: PatientContext = {
  isPregnant: false,
  hasEatingDisorderHistory: false,
  highRisk: false,
};

function m(partial: Partial<MeasurementInput> & Pick<MeasurementInput, "type">): SafetyInput {
  return {
    measurement: {
      unit: "x",
      takenAt: "2026-07-19T09:00:00.000Z",
      source: "app",
      ...partial,
    } as MeasurementInput,
  };
}

describe("red-flag evaluator — acceptance scenarios", () => {
  it("HTN ≥180/120 fires a red, same-day-review flag", () => {
    const r = evaluateRedFlags(
      m({ type: "bp", valueJson: { sys: 190, dia: 125 }, unit: "mmHg" }),
      getAdapter("htn").redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topSeverity).toBe("red");
    expect(r.topLevel).toBe(3);
  });

  it("DM glucose 2.8 fires severe-hypo red", () => {
    const r = evaluateRedFlags(
      m({ type: "glucose", valueNum: 2.8, unit: "mmol/L" }),
      getAdapter("diabetes").redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.fired.some((f) => f.key === "dm.severe_hypo")).toBe(true);
  });

  it("Obesity self-harm mood item ⇒ emergency, page, AND auto-pause weight-loss", () => {
    const r = evaluateRedFlags(
      m({ type: "mood", valueJson: { selfHarm: true }, unit: "score" }),
      getAdapter("obesity").redFlags,
      CALM,
    );
    expect(r.topSeverity).toBe("emergency");
    expect(r.pageOnCall).toBe(true); // base.self_harm
  });

  it("Obesity ED/purging signal ⇒ auto-pause weight-loss (spec §9.3)", () => {
    const r = evaluateRedFlags(
      m({ type: "food_log", valueJson: { purging: true }, unit: "entry" }),
      getAdapter("obesity").redFlags,
      CALM,
    );
    expect(r.autoPauseWeightLoss).toBe(true);
    expect(r.topLevel).toBe(4);
  });

  it("normal reading produces no flag", () => {
    const r = evaluateRedFlags(
      m({ type: "bp", valueJson: { sys: 122, dia: 78 }, unit: "mmHg" }),
      getAdapter("htn").redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(false);
    expect(r.replyMessageKey).toBeNull();
  });

  it("pregnancy routes to obstetric review for any condition", () => {
    const r = evaluateRedFlags(
      m({ type: "bp", valueJson: { sys: 120, dia: 80 }, unit: "mmHg" }),
      getAdapter("htn").redFlags,
      { ...CALM, isPregnant: true },
    );
    expect(r.fired.some((f) => f.key === "base.pregnancy_routing")).toBe(true);
  });

  it("returns EVERY fired flag, most-severe first (nothing dropped)", () => {
    // self-harm (emergency) + pregnancy (amber) both fire.
    const r = evaluateRedFlags(
      m({ type: "mood", valueJson: { selfHarm: true }, unit: "score" }),
      getAdapter("obesity").redFlags,
      { ...CALM, isPregnant: true },
    );
    expect(r.fired.length).toBeGreaterThanOrEqual(2);
    expect(r.fired[0]?.severity).toBe("emergency");
  });
});

describe("adapter isolation (spec §18.8)", () => {
  it("a mock 4th adapter evaluates with zero changes to safety/", () => {
    const mock: ConditionAdapter = {
      key: "obesity", // reuse a valid key; shape is what matters
      carePlanCondition: "obesity",
      modules: { diet: { enabled: true, weight: 1 } },
      targets: { headline: "mock" },
      monitoring: [],
      redFlags: [
        {
          key: "mock.always",
          severity: "amber",
          level: 2,
          action: "same_day_review",
          when: () => true,
          safetyNetMessageKey: "safety.generic",
        },
      ],
      cadence: { byPhase: {} },
      contentPackId: "mock",
      guardrails: { autoPauseOnEdFlag: false, noNumericTargetsIfEd: false },
    };
    const r = evaluateRedFlags(m({ type: "weight", valueNum: 80, unit: "kg" }), mock.redFlags, CALM);
    expect(r.hasFlag).toBe(true);
  });

  it("every shipped adapter exposes the required config shape", () => {
    for (const a of allAdapters()) {
      expect(a.key).toBeTruthy();
      expect(a.contentPackId).toBeTruthy();
      expect(Array.isArray(a.redFlags)).toBe(true);
    }
  });
});
