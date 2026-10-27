import { describe, expect, it } from "@jest/globals";
import { applyProxyPregnancyFloor, applyProxyPregnancyRule, pathwayIsSelfOnly } from "./proxy-pregnancy";
import { runTriage } from "../engine/index";
import { S59D_DRAFT_PATHWAYS } from "../protocols/s59d-drafts";
import { PAEDIATRIC_DRAFT_PATHWAYS } from "../protocols/paediatric-drafts";
import { SEED_PATHWAYS } from "../protocols/index";
import { categoryAtLeast, type AnswerMap, type PresentingComplaintProtocol, type SymptomCapture, type TriageCategory } from "../types/index";

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
const byKey = (k: string): PresentingComplaintProtocol => [...SEED_PATHWAYS, ...S59D_DRAFT_PATHWAYS].find((p) => p.key === k)!;

/** What the app does for a proxy: the engine sees the capture as ticked, the result is floored, only the STORED capture loses the answer. */
function proxyResult(p: PresentingComplaintProtocol, c: SymptomCapture, answers: AnswerMap): { category: TriageCategory; stored: SymptomCapture } {
  const rule = applyProxyPregnancyRule(c, true);
  const r = runTriage(p, rule.engineCapture, answers);
  return { category: applyProxyPregnancyFloor(r.category, rule.pregnancyTickedByProxy).category, stored: rule.storedCapture };
}

describe("pregnancy answers are the person's own (OQ-S59d-05)", () => {
  it("a proxy is blocked from the pregnancy pathway, the person themselves is not", () => {
    expect(applyProxyPregnancyRule(cap({ presentingComplaintKey: "pregnancy_danger_signs" }), true).blocked).toBe(true);
    expect(applyProxyPregnancyRule(cap({ presentingComplaintKey: "pregnancy_danger_signs" }), false).blocked).toBe(false);
    expect(pathwayIsSelfOnly("pregnancy_danger_signs")).toBe(true);
    expect(pathwayIsSelfOnly("headache")).toBe(false);
  });

  it("the pregnancy answer is never STORED for a proxy, but the engine still sees it; the person's own capture is untouched", () => {
    const c = cap({ relevantHistory: ["pregnant", "hypertension"], associatedSymptoms: ["confusion"] });
    const proxy = applyProxyPregnancyRule(c, true);
    expect(proxy.strippedPregnancy).toBe(true);
    expect(proxy.pregnancyTickedByProxy).toBe(true);
    expect(proxy.storedCapture.relevantHistory).toEqual(["hypertension"]);
    expect(proxy.engineCapture.relevantHistory).toEqual(["pregnant", "hypertension"]);
    const self = applyProxyPregnancyRule(c, false);
    expect(self.storedCapture).toBe(c);
    expect(self.engineCapture).toBe(c);
    expect(self.pregnancyTickedByProxy).toBe(false);
    expect(applyProxyPregnancyRule(cap(), true).pregnancyTickedByProxy).toBe(false);
  });

  it("the floor raises to urgent, never lowers, and does nothing when no proxy ticked pregnant", () => {
    expect(applyProxyPregnancyFloor("self_management", true)).toEqual({ category: "urgent", raised: true });
    expect(applyProxyPregnancyFloor("routine", true)).toEqual({ category: "urgent", raised: true });
    expect(applyProxyPregnancyFloor("urgent", true)).toEqual({ category: "urgent", raised: false });
    expect(applyProxyPregnancyFloor("emergency", true)).toEqual({ category: "emergency", raised: false });
    expect(applyProxyPregnancyFloor("self_management", false)).toEqual({ category: "self_management", raised: false });
  });

  it("REGRESSION (review): a proxy ticking pregnant on a headache or a fever is not lower than the person doing it themselves", () => {
    const headache = SEED_PATHWAYS.find((p) => p.key === "headache")!;
    const mild = cap({ presentingComplaintKey: "headache", severity: 6, relevantHistory: ["pregnant"] }); // headache.pregnancy_severe: urgent
    const self = runTriage(headache, mild, {}).category;
    expect(self).toBe("urgent");
    expect(proxyResult(headache, mild, {}).category).toBe("urgent");
    // dropping the answer (the earlier behaviour) would have been lower
    expect(categoryAtLeast(runTriage(headache, { ...mild, relevantHistory: [] }, { duration_check: false, frequency_check: false, severity_check: "mild" }).category, "urgent")).toBe(false);
    const fever = byKey("fever");
    const f = cap({ presentingComplaintKey: "fever", severity: 1, relevantHistory: ["pregnant"] }); // fever.pregnant_any: urgent
    expect(runTriage(fever, f, {}).category).toBe("urgent");
    expect(proxyResult(fever, f, {}).category).toBe("urgent");
    // a mild fever with a proxy ticking pregnant and every answer reassuring is still floored at urgent
    const calm = { duration_check: false, hydration_check: true, severity_check: "mild", mild_test_check: true, mild_result_check: false } as AnswerMap;
    expect(proxyResult(fever, cap({ presentingComplaintKey: "fever", severity: 1, relevantHistory: [] }), calm).category).toBe("self_management");
    expect(proxyResult(fever, cap({ presentingComplaintKey: "fever", severity: 1, relevantHistory: ["pregnant"] }), calm).category).toBe("urgent");
    expect(proxyResult(fever, f, {}).stored.relevantHistory).toEqual([]);
  });
});

describe("property: ticking pregnant for someone else never gives a lower result (every pathway)", () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  it("result(proxy ticks pregnant) >= result(proxy does not) and >= result(self answers pregnant), 400 cases per pathway", () => {
    const r = rng(1022);
    const all = [...SEED_PATHWAYS, ...S59D_DRAFT_PATHWAYS, ...PAEDIATRIC_DRAFT_PATHWAYS].filter((p) => !pathwayIsSelfOnly(p.key));
    let checked = 0;
    for (const p of all) {
      const questions = Object.values(p.nodes).filter((n) => n.type === "question");
      for (let i = 0; i < 400; i++) {
        const some = (xs: string[]): string[] => xs.filter(() => r() < 0.3);
        const base = cap({
          presentingComplaintKey: p.key,
          severity: 1 + Math.floor(r() * 10),
          associatedSymptoms: some(p.knownAssociatedSymptoms),
          triggers: some(p.knownTriggers),
          relevantHistory: some(p.knownHistory).filter((h) => h !== "pregnant"),
        });
        const answers: AnswerMap = {};
        for (const q of questions) {
          if (q.type !== "question") continue;
          answers[q.key] = q.kind === "boolean" ? r() < 0.5 : (q.options[Math.floor(r() * q.options.length)]?.value ?? "");
        }
        const ticks = { ...base, relevantHistory: [...base.relevantHistory, "pregnant"] };
        const proxyTicks = proxyResult(p, ticks, answers).category;
        const proxyNoTick = proxyResult(p, base, answers).category;
        const selfPregnant = runTriage(p, ticks, answers).category;
        expect(categoryAtLeast(proxyTicks, proxyNoTick)).toBe(true);
        expect(categoryAtLeast(proxyTicks, selfPregnant)).toBe(true);
        expect(categoryAtLeast(proxyTicks, "urgent")).toBe(true);
        // and nothing about pregnancy is stored
        expect(proxyResult(p, ticks, answers).stored.relevantHistory).not.toContain("pregnant");
        checked++;
      }
    }
    expect(checked).toBe(all.length * 400);
  });

  it("SABOTAGE: the earlier behaviour (drop the answer before the engine) FAILS this property", () => {
    const headache = SEED_PATHWAYS.find((p) => p.key === "headache")!;
    const ticks = cap({ presentingComplaintKey: "headache", severity: 6, relevantHistory: ["pregnant"] });
    const dropped = applyProxyPregnancyRule(ticks, true).storedCapture; // what the engine used to be given
    const answers = { duration_check: false, frequency_check: false, severity_check: "mild" } as AnswerMap;
    expect(categoryAtLeast(runTriage(headache, dropped, answers).category, runTriage(headache, ticks, {}).category)).toBe(false);
  });
});
