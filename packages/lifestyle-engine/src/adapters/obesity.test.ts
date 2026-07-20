/**
 * Obesity medical / AOM red-flag rules (TH-CP-OB-001 §13.3, §16.2).
 * These sit on top of the ED/self-harm auto-pause guardrail already covered in
 * safety.test.ts and must stay green.
 */
import { describe, it, expect } from "@jest/globals";
import { evaluateRedFlags } from "../safety/index";
import { obesityAdapter } from "./obesity";
import type { MeasurementInput, PatientContext, SafetyInput } from "../types/index";

const CALM: PatientContext = {
  isPregnant: false,
  hasEatingDisorderHistory: false,
  highRisk: false,
};

function m(partial: Partial<MeasurementInput> & Pick<MeasurementInput, "type">): SafetyInput {
  return {
    measurement: {
      unit: "x",
      takenAt: "2026-07-20T09:00:00.000Z",
      source: "app",
      ...partial,
    } as MeasurementInput,
  };
}

describe("obesity medical red flags", () => {
  it("chest pain fires an emergency page", () => {
    const r = evaluateRedFlags(
      m({ type: "symptom", valueJson: { chestPain: true } }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topSeverity).toBe("emergency");
    expect(r.topLevel).toBe(4);
  });

  it("severe abdominal pain (AOM/GLP-1 warning) fires a red same-day review", () => {
    const r = evaluateRedFlags(
      m({ type: "symptom", valueJson: { severeAbdominalPain: true } }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topSeverity).toBe("red");
    expect(r.topLevel).toBe(3);
  });

  it("unintentional weight loss is flagged (not celebrated)", () => {
    const r = evaluateRedFlags(
      m({ type: "symptom", valueJson: { unintentionalWeightLoss: true } }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topSeverity).toBe("red");
  });

  it("witnessed apnoea triggers an OSA referral flag", () => {
    const r = evaluateRedFlags(
      m({ type: "symptom", valueJson: { witnessedApnoea: true } }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
  });

  it("ED / self-harm still auto-pauses weight-loss (guardrail intact)", () => {
    const r = evaluateRedFlags(
      m({ type: "mood", valueJson: { eatingDisorderRisk: true } }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(true);
    expect(r.topSeverity).toBe("emergency");
    expect(r.autoPauseWeightLoss).toBe(true);
  });

  it("an ordinary weight log fires nothing", () => {
    const r = evaluateRedFlags(
      m({ type: "weight", valueNum: 92, unit: "kg" }),
      obesityAdapter.redFlags,
      CALM,
    );
    expect(r.hasFlag).toBe(false);
  });
});
