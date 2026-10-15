import {
  loadAsthmaCopdConfig,
  loadCkdConfig,
  loadHeartFailureConfig,
  type AsthmaCopdConfig,
  type CkdConfig,
  type HeartFailureConfig,
} from "../config";
import type { PathwayCondition, PathwayFacts, PathwayRule, PathwayRuleSet } from "../types";

/**
 * Release 3 pathway rule sets on the same engine (S61, spec 13.6, 13.7): asthma and COPD, heart failure, chronic kidney disease. DRAFT.
 * Numbers come from the PROPOSED config (CMO decision pack Q11 and Q12 option A), never from this file. Sickle cell and post-stroke have
 * NO rule set on purpose: their adult red lines were not verified (Q12), so they are registry scaffolds with their guards off.
 * No rule here proposes or names a medicine.
 */
const f = (field: string, op: "gte" | "gt" | "lte" | "lt" | "eq" | "neq", value: number | boolean | { ref: string }): PathwayCondition => ({ field, op, value });
const p = (name: string) => ({ ref: `params.${name}` });
const NOTIFY = "notify.triage.task_created";
const REVIEW = "amber_pathway_review";

/* ------------------------------ asthma and COPD ------------------------------ */

export interface AsthmaFactsInput {
  /** Manual reliever log: puffs-taken events with their times. No sensor. */
  readonly relieverUseTimes: readonly string[];
  /** Reliever canisters collected or bought in the last 12 months (pharmacy supply or the patient's own count). */
  readonly canistersLast12m: number | null;
  readonly cannotFinishSentence: boolean;
  /** Reliever used and no relief. */
  readonly noReliefFromReliever: boolean;
  readonly peakFlow: number | null;
  readonly peakFlowBest: number | null;
  /** Only where the patient has an oximeter; null otherwise (Q11). */
  readonly spo2Pct: number | null;
  readonly now: string;
}

export function buildAsthmaFacts(i: AsthmaFactsInput): PathwayFacts {
  const nowMs = Date.parse(i.now);
  const uses = i.relieverUseTimes.filter((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms <= nowMs && nowMs - ms < 7 * 86_400_000;
  }).length;
  const pct = i.peakFlow !== null && i.peakFlowBest !== null && i.peakFlowBest > 0 ? (i.peakFlow / i.peakFlowBest) * 100 : null;
  return {
    "reliever.usesLast7d": uses,
    "reliever.canistersLast12m": i.canistersLast12m,
    "symptom.cannotFinishSentence": i.cannotFinishSentence,
    "reliever.noRelief": i.noReliefFromReliever,
    "peakflow.pctOfBest": pct,
    "spo2.pct": i.spo2Pct,
  };
}

export function buildAsthmaCopdRuleSet(cfg: AsthmaCopdConfig = loadAsthmaCopdConfig().value, version = 1): PathwayRuleSet {
  const rules: PathwayRule[] = [
    {
      id: "AS-R1", description: "Cannot finish a sentence, no relief from the reliever, low peak flow, or low oxygen where measured", grade: "red",
      explanationKey: "PW-AS-RED",
      when: { any: [f("symptom.cannotFinishSentence", "eq", true), f("reliever.noRelief", "eq", true), f("peakflow.pctOfBest", "lt", p("peakFlowRedBelowPctOfBest")), f("spo2.pct", "lt", p("spo2RedBelowPct"))] },
      actions: [{ kind: "show_emergency_guidance", code: "PW-AS-RED" }, { kind: "page_on_call" }],
    },
    {
      id: "AS-A1", description: "Reliever used more than the weekly line, or many canisters in a year", grade: "amber", explanationKey: "PW-GEN-REVIEW",
      when: { any: [f("reliever.usesLast7d", "gt", p("relieverUsesPerWeekFlag")), f("reliever.canistersLast12m", "gte", p("relieversPerYearFlag"))] },
      actions: [{ kind: "show_message", code: "PW-GEN-REVIEW" }, { kind: "create_task", task: REVIEW, dueMinutes: cfg.reviewDueMinutes, notifyKey: NOTIFY }], taskAnchor: "week",
    },
    { id: "AS-G1", description: "A reliever log with no flag", grade: "green", explanationKey: "PW-GEN-LOGGED", when: f("reliever.usesLast7d", "gte", 0), actions: [] },
  ];
  return {
    code: "asthma_copd_care_triage", version, status: "draft", rules,
    params: {
      relieverUsesPerWeekFlag: cfg.relieverUsesPerWeekFlag, relieversPerYearFlag: cfg.relieversPerYearFlag,
      peakFlowRedBelowPctOfBest: cfg.peakFlowRedBelowPctOfBest, spo2RedBelowPct: cfg.spo2RedBelowPct,
    },
  };
}

/* -------------------------------- heart failure -------------------------------- */

export interface WeightPoint { readonly kg: number; readonly at: string }

export function buildHeartFailureFacts(latest: WeightPoint, history: readonly WeightPoint[], now: string, cfg: HeartFailureConfig = loadHeartFailureConfig().value): PathwayFacts {
  const nowMs = Date.parse(now);
  const window = history.filter((w) => {
    const ms = Date.parse(w.at);
    return Number.isFinite(ms) && ms <= Date.parse(latest.at) && nowMs - ms <= cfg.weightGainDays * 86_400_000;
  });
  const lowest = window.length === 0 ? null : Math.min(...window.map((w) => w.kg));
  // gain in the trailing window: latest minus the lowest earlier reading, rounded to 0.01 kg so 2.0 kg is not 2.0000001
  return { "weight.gainKgInWindow": lowest === null ? null : Math.round((latest.kg - lowest) * 100) / 100 };
}

export function buildHeartFailureRuleSet(cfg: HeartFailureConfig = loadHeartFailureConfig().value, version = 1): PathwayRuleSet {
  return {
    code: "heart_failure_triage", version, status: "draft", params: { weightGainKg: cfg.weightGainKg },
    rules: [
      {
        id: "HF-A1", description: "Weight up by more than the line within the window", grade: "amber", explanationKey: "PW-GEN-REVIEW",
        when: f("weight.gainKgInWindow", "gt", p("weightGainKg")),
        actions: [{ kind: "show_message", code: "PW-GEN-REVIEW" }, { kind: "create_task", task: REVIEW, dueMinutes: cfg.reviewDueMinutes, notifyKey: NOTIFY }], taskAnchor: "reading",
      },
      { id: "HF-G1", description: "A weight with no flag", grade: "green", explanationKey: "PW-GEN-LOGGED", when: f("weight.gainKgInWindow", "gte", -1000), actions: [] },
    ],
  };
}

/* ------------------------------------- CKD ------------------------------------- */

export interface CkdFactsInput {
  readonly egfr: number | null;
  readonly acrMgPerG: number | null;
  /** eGFR values (mL/min/1.73m2) with dates, earlier than the current one. */
  readonly egfrHistory: readonly { readonly value: number; readonly at: string }[];
  readonly refractoryHypertension: boolean;
  readonly now: string;
}

export function buildCkdFacts(i: CkdFactsInput, cfg: CkdConfig = loadCkdConfig().value): PathwayFacts {
  const nowMs = Date.parse(i.now);
  const earlier = i.egfrHistory.filter((h) => {
    const ms = Date.parse(h.at);
    return Number.isFinite(ms) && ms <= nowMs && nowMs - ms <= cfg.fallWindowDays * 86_400_000;
  });
  // the fall is measured from the highest earlier value in the window, so a single high outlier cannot be hidden by a recent dip
  const peak = earlier.length === 0 ? null : Math.max(...earlier.map((h) => h.value));
  const absFall = i.egfr !== null && peak !== null ? peak - i.egfr : null;
  const pctFall = absFall !== null && peak !== null && peak > 0 ? (absFall / peak) * 100 : null;
  return {
    "egfr.value": i.egfr,
    "acr.mgPerG": i.acrMgPerG,
    "egfr.fallPct": pctFall,
    "egfr.fallAbs": absFall,
    "hypertension.refractory": i.refractoryHypertension,
  };
}

export function buildCkdRuleSet(cfg: CkdConfig = loadCkdConfig().value, version = 1): PathwayRuleSet {
  return {
    code: "ckd_monitoring_triage", version, status: "draft",
    params: { referEgfrBelow: cfg.referEgfrBelow, referAcrMgPerG: cfg.referAcrMgPerG, sustainedFallPct: cfg.sustainedFallPct, sustainedFallMlPerMin: cfg.sustainedFallMlPerMin },
    rules: [
      {
        id: "CKD-A1", description: "Refer: low eGFR, high ACR, a sustained fall, or refractory hypertension", grade: "amber", explanationKey: "PW-GEN-REVIEW",
        when: {
          any: [
            f("egfr.value", "lt", p("referEgfrBelow")),
            f("acr.mgPerG", "gte", p("referAcrMgPerG")),
            // decision pack Q12: a fall over the percentage OR over the absolute amount within the window (either one refers)
            f("egfr.fallPct", "gt", p("sustainedFallPct")),
            f("egfr.fallAbs", "gte", p("sustainedFallMlPerMin")),
            f("hypertension.refractory", "eq", true),
          ],
        },
        actions: [
          { kind: "show_message", code: "PW-GEN-REVIEW" },
          { kind: "route_referral", reason: "ckd_referral_criteria" },
          { kind: "create_task", task: REVIEW, dueMinutes: cfg.reviewDueMinutes, notifyKey: NOTIFY },
        ],
        taskAnchor: "week",
      },
      { id: "CKD-G1", description: "Kidney results with no flag", grade: "green", explanationKey: "PW-GEN-LOGGED", when: f("egfr.value", "gte", 0), actions: [] },
    ],
  };
}

export const ASTHMA_COPD_V1 = buildAsthmaCopdRuleSet();
export const HEART_FAILURE_V1 = buildHeartFailureRuleSet();
export const CKD_V1 = buildCkdRuleSet();
