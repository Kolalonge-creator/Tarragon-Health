import { loadGlucoseConfig, type GlucoseConfig } from "../config";
import type { PathwayCondition, PathwayFacts, PathwayRule, PathwayRuleSet } from "../types";

/**
 * Diabetes triage rule set `diabetes_care_triage` (S61, spec 13.2/13.14). TRIAGE AND INSIGHTS ONLY: no rule here proposes or names a
 * medicine, and no rule references an insulin dose (CMO decision Q8, Part C: no automated insulin dosing). DRAFT: every number is read
 * from the PROPOSED config entry `diabetes.glucose_thresholds` when the rule set is built, so a number is never typed twice. The CMO
 * signs it (never an agent); until a signature the server records its grades as shadow and nobody is paged by it (OQ-88).
 *
 * Decision Q5: below severeHypo, or any confusion, seizure, unresponsiveness or "needed another person's help" at any reading below
 * hypoAlert, is RED and pages on call (INV-05). A reading from severeHypo up to hypoAlert with none of those is AMBER with the 15 g
 * advice and a `hypo_follow_up` task. Insulin or sulfonylurea use (or unknown) tightens the task due time, never loosens it.
 */
export const GLUCOSE_EVENT_CODES = ["confusion", "seizure", "unresponsive", "needed_help"] as const;
export type GlucoseEventCode = (typeof GLUCOSE_EVENT_CODES)[number];

export interface GlucoseReadingFact {
  readonly mmol: number;
  readonly takenAt: string;
  readonly events?: readonly GlucoseEventCode[];
}

export interface GlucoseFactsInput {
  /** The reading being graded. */
  readonly latest: GlucoseReadingFact;
  /** Earlier readings in the trailing window (the latest is NOT repeated here). */
  readonly history: readonly GlucoseReadingFact[];
  readonly ketoneMmol: number | null;
  readonly ketoneUrine: "negative" | "trace" | "small" | "moderate" | "large" | null;
  /** True or null (unknown) tightens; only an explicit false loosens. */
  readonly insulinOrSulfonylurea: boolean | null;
  /** Relax-only individual target for the amber persistent-high band; never lowers the guideline line. */
  readonly persistentHighOverride?: number;
  readonly now: string;
}

const DAY_MS = 86_400_000;

/** Builds the flat facts the diabetes rules read from raw readings. Pure; the one place window counting lives. */
export function buildGlucoseFacts(input: GlucoseFactsInput, cfg: GlucoseConfig = loadGlucoseConfig().value): PathwayFacts {
  const nowMs = Date.parse(input.now);
  const inWindow = (r: GlucoseReadingFact, days: number): boolean => {
    const t = Date.parse(r.takenAt);
    return Number.isFinite(t) && t <= nowMs && nowMs - t < days * DAY_MS;
  };
  const all = [input.latest, ...input.history];
  const window = all.filter((r) => inWindow(r, cfg.windowDays));
  const persistentHigh = Math.max(cfg.persistentHigh, input.persistentHighOverride ?? 0);
  const events = input.latest.events ?? [];
  const neuro = events.some((e) => e === "confusion" || e === "seizure" || e === "unresponsive");
  const level2or3 = (r: GlucoseReadingFact): boolean => r.mmol < cfg.severeHypo || (r.mmol < cfg.hypoAlert && (r.events ?? []).length > 0);
  const urine = input.ketoneUrine;
  return {
    "glucose.mmol": input.latest.mmol,
    "ketone.high": (input.ketoneMmol !== null && input.ketoneMmol >= cfg.ketoneHigh) || urine === "moderate" || urine === "large",
    "ketone.moderate":
      (input.ketoneMmol !== null && input.ketoneMmol >= cfg.ketoneModerate && input.ketoneMmol < cfg.ketoneHigh) || urine === "small",
    "symptom.neuro": neuro,
    "symptom.assisted": events.includes("needed_help"),
    "treatment.insulinOrSulfonylurea": input.insulinOrSulfonylurea,
    "window.highCount": window.filter((r) => r.mmol > persistentHigh).length,
    "window.lowCount": window.filter((r) => r.mmol < cfg.hypoAlert).length,
    "events.level2or3Count": all.filter((r) => inWindow(r, cfg.level2MedReviewWindowDays) && level2or3(r)).length,
  };
}

const f = (field: string, op: "gte" | "gt" | "lte" | "lt" | "eq" | "neq", value: number | boolean | { ref: string }): PathwayCondition => ({ field, op, value });
const p = (name: string) => ({ ref: `params.${name}` });
const TASK_NOTIFY = "notify.triage.task_created";
const task = (type: string, dueParam: keyof GlucoseConfig, cfg: GlucoseConfig) =>
  ({ kind: "create_task", task: type, dueMinutes: cfg[dueParam], notifyKey: TASK_NOTIFY }) as const;

export function buildDiabetesCareRuleSet(cfg: GlucoseConfig = loadGlucoseConfig().value, version = 1): PathwayRuleSet {
  const lowBand = { all: [f("glucose.mmol", "gte", p("severeHypo")), f("glucose.mmol", "lt", p("hypoAlert"))] } as PathwayCondition;
  const red = (id: string, description: string, when: PathwayCondition, code: string): PathwayRule => ({
    id, description, grade: "red", explanationKey: code, when,
    actions: [{ kind: "show_emergency_guidance", code }, { kind: "page_on_call" }],
  });
  const review = (id: string, description: string, when: PathwayCondition, due: keyof GlucoseConfig, taskType = "amber_glucose_review", anchor: "reading" | "week" = "reading"): PathwayRule => ({
    id, description, grade: "amber", explanationKey: "PW-DM-REVIEW", when,
    actions: [{ kind: "show_message", code: "PW-DM-REVIEW" }, task(taskType, due, cfg)], taskAnchor: anchor,
  });
  const rules: PathwayRule[] = [
    red("DM-R1", "Glucose below the severe low line", f("glucose.mmol", "lt", p("severeHypo")), "PW-DM-RED"),
    red("DM-R2", "Glucose below the low line with confusion, a seizure, unresponsiveness or help needed",
      { all: [f("glucose.mmol", "lt", p("hypoAlert")), { any: [f("symptom.neuro", "eq", true), f("symptom.assisted", "eq", true)] }] }, "PW-DM-RED"),
    red("DM-R3", "High glucose with raised ketones (suspected DKA)",
      { all: [f("glucose.mmol", "gte", p("highForDka")), f("ketone.high", "eq", true)] }, "PW-DM-DKA"),
    {
      id: "DM-A1", description: "Low glucose, no danger symptom, on insulin or a sulfonylurea (or not known)", grade: "amber", explanationKey: "PW-DM-LOW",
      when: { all: [lowBand, f("treatment.insulinOrSulfonylurea", "neq", false)] },
      actions: [{ kind: "show_message", code: "PW-DM-LOW" }, task("hypo_follow_up", "insulinOrSulfonylureaDueMinutes", cfg)], taskAnchor: "reading",
    },
    {
      id: "DM-A2", description: "Low glucose, no danger symptom, known not to be on insulin or a sulfonylurea", grade: "amber", explanationKey: "PW-DM-LOW",
      when: { all: [lowBand, f("treatment.insulinOrSulfonylurea", "eq", false)] },
      actions: [{ kind: "show_message", code: "PW-DM-LOW" }, task("hypo_follow_up", "otherHypoFollowUpDueMinutes", cfg)], taskAnchor: "reading",
    },
    review("DM-A3", "Very high glucose", f("glucose.mmol", "gte", p("veryHigh")), "urgentReviewDueMinutes"),
    review("DM-A4", "Raised ketones without a high glucose", f("ketone.high", "eq", true), "urgentReviewDueMinutes"),
    review("DM-A5", "Repeated serious lows: review the glucose-lowering medicines", f("events.level2or3Count", "gte", p("level2MedReviewCount")), "urgentReviewDueMinutes", "amber_glucose_review", "week"),
    review("DM-A6", "Persistent high glucose", f("window.highCount", "gte", p("persistentHighMinCount")), "routineReviewDueMinutes", "amber_glucose_review", "week"),
    review("DM-A7", "Recurrent low glucose", f("window.lowCount", "gte", p("recurrentHypoMinCount")), "otherHypoFollowUpDueMinutes", "amber_glucose_review", "week"),
    review("DM-A8", "Moderate ketones", f("ketone.moderate", "eq", true), "routineReviewDueMinutes"),
    { id: "DM-G1", description: "A glucose reading with no flag", grade: "green", explanationKey: "PW-DM-LOGGED", when: f("glucose.mmol", "gte", 0), actions: [] },
  ];
  const params: Record<string, number> = {};
  for (const k of [
    "severeHypo", "hypoAlert", "highForDka", "veryHigh", "persistentHighMinCount", "recurrentHypoMinCount", "level2MedReviewCount",
  ] as const) params[k] = cfg[k];
  return { code: "diabetes_care_triage", version, status: "draft", params, rules };
}

/** The bundled draft rule set, built from the config in force. */
export const DIABETES_CARE_V1: PathwayRuleSet = buildDiabetesCareRuleSet();
