import { describe, expect, it } from "@jest/globals";
import { applyProxyPregnancyRule, pathwayIsSelfOnly } from "./proxy-pregnancy";
import { runTriage } from "../engine/index";
import { S59D_DRAFT_PATHWAYS } from "../protocols/s59d-drafts";
import type { SymptomCapture } from "../types/index";

const cap = (p: Partial<SymptomCapture> = {}): SymptomCapture => ({
  presentingComplaintKey: "headache",
  onset: "gradual",
  severity: 4,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});

describe("pregnancy answers are the person's own (OQ-S59d-05)", () => {
  it("a proxy is blocked from the pregnancy pathway, the person themselves is not", () => {
    expect(applyProxyPregnancyRule(cap({ presentingComplaintKey: "pregnancy_danger_signs" }), true).blocked).toBe(true);
    expect(applyProxyPregnancyRule(cap({ presentingComplaintKey: "pregnancy_danger_signs" }), false).blocked).toBe(false);
    expect(pathwayIsSelfOnly("pregnancy_danger_signs")).toBe(true);
    expect(pathwayIsSelfOnly("headache")).toBe(false);
  });

  it("a proxy's 'pregnant' answer is removed; everything else is kept; the person's own capture is returned as it was", () => {
    const c = cap({ relevantHistory: ["pregnant", "hypertension"], associatedSymptoms: ["confusion"] });
    const proxy = applyProxyPregnancyRule(c, true);
    expect(proxy.strippedPregnancy).toBe(true);
    expect(proxy.capture.relevantHistory).toEqual(["hypertension"]);
    expect(proxy.capture.associatedSymptoms).toEqual(["confusion"]);
    const self = applyProxyPregnancyRule(c, false);
    expect(self.capture).toBe(c);
    expect(self.strippedPregnancy).toBe(false);
  });

  it("removing the pregnancy answer never lowers a result: a proxy's emergency stays an emergency", () => {
    const headache = { ...S59D_DRAFT_PATHWAYS[2]! };
    for (const history of [["pregnant"], ["pregnant", "hypertension"], []]) {
      const c = cap({ presentingComplaintKey: "hypertension_complication", associatedSymptoms: ["chest_pain"], relevantHistory: history });
      const after = applyProxyPregnancyRule(c, true).capture;
      expect(runTriage(headache, after, {}).category).toBe("emergency");
    }
  });

  it("SABOTAGE: a rule that did not strip would let the answer through (the check is not vacuous)", () => {
    const c = cap({ relevantHistory: ["pregnant"] });
    const noop = { capture: c };
    expect(noop.capture.relevantHistory).toContain("pregnant");
    expect(applyProxyPregnancyRule(c, true).capture.relevantHistory).not.toContain("pregnant");
  });
});
