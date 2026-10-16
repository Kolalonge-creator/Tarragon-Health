/**
 * Digital therapy programmes (S63, Module 14): the pure rules shared by web, mobile and the progress handler.
 *
 * What is here, and what is deliberately not:
 *  - the entry screen (14.9). It is table-driven (the rows come from the exclusion list a programme names, never from code) and it
 *    FAILS CLOSED: an item that is not answered, or is answered with the wrong kind of value, counts as a positive. A programme with no
 *    list at all admits nobody. The database function `public.therapy_check_entry_screen` applies the same rule; the proof script
 *    runs both against the same table. The same function is used on the phone so urgent guidance can show with no network.
 *  - the worsening check against baseline (14.9, `programme-progress`). It reports which instrument crossed which configured threshold.
 *    It applies no number of its own; every threshold is a PROPOSED value read from `therapy.programme_config`.
 *  - what is not here: any clinical judgement beyond the CMO's rows, any model, any outcome claim. These programmes are self-help with a
 *    route to a clinician, never therapy.
 */
import { getProposedConfig } from "./proposed-config";
import {
  THERAPY_PROGRAMME_CODES,
  type TherapyExclusionRule,
  type TherapyProgrammeCode,
  type TherapyProgrammeConfig,
  type TherapyRoute,
  type TherapyWorseningRule,
} from "./proposed-config/therapy-config-data";

export { THERAPY_PROGRAMME_CODES };
export type { TherapyExclusionRule, TherapyProgrammeCode, TherapyProgrammeConfig, TherapyRoute, TherapyWorseningRule };

export type TherapyAnswerValue = boolean | number | null | undefined;
export type TherapyAnswers = Readonly<Record<string, TherapyAnswerValue>>;

/** Highest first. A crisis outranks everything; education only is the mildest (no clinician task). */
export const THERAPY_ROUTE_PRIORITY: readonly TherapyRoute[] = ["crisis", "same_day_clinician", "medical_review_first", "education_only"];

export interface TherapyStop {
  readonly code: string;
  readonly route: TherapyRoute;
  /** A local item the CMO has not confirmed. It still stops the programme. */
  readonly unverified: boolean;
  /** true when the stop is because the item was not answered properly, not because it was answered "yes". */
  readonly unanswered: boolean;
}

export interface TherapyScreenResult {
  readonly passed: boolean;
  /** The most urgent route among the stops. null when passed. */
  readonly route: TherapyRoute | null;
  readonly stops: readonly TherapyStop[];
  /** true when the programme has no exclusion list at all (it admits nobody). */
  readonly noRules: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Whether one rule is positive for these answers. Fail closed: anything but a well-formed answer is positive.
 * yes_no needs a boolean; score_at_least and score_below need a finite number.
 */
export function ruleIsPositive(rule: TherapyExclusionRule, answers: TherapyAnswers): { positive: boolean; unanswered: boolean } {
  const a = answers[rule.code];
  if (rule.kind === "yes_no") {
    if (typeof a !== "boolean") return { positive: true, unanswered: true };
    return { positive: a, unanswered: false };
  }
  if (!isNum(a) || !isNum(rule.threshold)) return { positive: true, unanswered: true };
  return { positive: rule.kind === "score_at_least" ? a >= rule.threshold : a < rule.threshold, unanswered: false };
}

export function mostUrgentRoute(routes: readonly TherapyRoute[]): TherapyRoute | null {
  for (const r of THERAPY_ROUTE_PRIORITY) if (routes.includes(r)) return r;
  return null;
}

/** Runs an exclusion list over a set of answers. Pure; the entry screen and the per-session re-check both call it. */
export function evaluateEntryScreen(rules: readonly TherapyExclusionRule[], answers: TherapyAnswers | null | undefined): TherapyScreenResult {
  if (rules.length === 0) return { passed: false, route: null, stops: [], noRules: true };
  const given = answers ?? {};
  const stops: TherapyStop[] = [];
  for (const rule of rules) {
    const { positive, unanswered } = ruleIsPositive(rule, given);
    if (positive) stops.push({ code: rule.code, route: rule.route, unverified: rule.unverified === true, unanswered });
  }
  return { passed: stops.length === 0, route: mostUrgentRoute(stops.map((s) => s.route)), stops, noRules: false };
}

/** The i18n message key for the card a route shows. Every card says what to do next and carries no phone number. */
export function guidanceKeyForRoute(route: TherapyRoute | null, noRules = false): string {
  if (noRules || route === null) return "therapy.guidance.not_available";
  return `therapy.guidance.${route}`;
}

/** The exclusion list in force for a programme from the versioned PROPOSED configuration (used for the offline pre-check). */
export function therapyExclusionRules(code: TherapyProgrammeCode): readonly TherapyExclusionRule[] {
  const lists = getProposedConfig("therapy.exclusion_lists").value as unknown as Readonly<Record<string, readonly TherapyExclusionRule[]>>;
  return lists[code] ?? [];
}

export function therapyProgrammeConfig(): TherapyProgrammeConfig {
  return getProposedConfig("therapy.programme_config").value as unknown as TherapyProgrammeConfig;
}

export function isTherapyProgrammeCode(v: unknown): v is TherapyProgrammeCode {
  return typeof v === "string" && (THERAPY_PROGRAMME_CODES as readonly string[]).includes(v);
}

export function checkpointsFor(code: TherapyProgrammeCode, config: TherapyProgrammeConfig = therapyProgrammeConfig()): readonly number[] {
  return config.checkpoints[code] ?? [];
}

export function isCheckpoint(code: TherapyProgrammeCode, ordinal: number, config: TherapyProgrammeConfig = therapyProgrammeConfig()): boolean {
  return checkpointsFor(code, config).includes(ordinal);
}

export type ScoreProblem = "unknown_instrument" | "out_of_range" | "missing_instrument" | "not_a_checkpoint";

/** Checks scores entered at a checkpoint: only the programme's own instruments, each a whole number inside its range. */
export function validateScores(
  code: TherapyProgrammeCode,
  ordinal: number,
  scores: Readonly<Record<string, unknown>>,
  config: TherapyProgrammeConfig = therapyProgrammeConfig(),
): ScoreProblem | null {
  if (!isCheckpoint(code, ordinal, config)) return "not_a_checkpoint";
  const wanted = config.instruments[code] ?? [];
  for (const key of Object.keys(scores)) if (!wanted.includes(key)) return "unknown_instrument";
  for (const key of wanted) {
    const v = scores[key];
    const range = config.instrument_ranges[key];
    if (!isNum(v) || !Number.isInteger(v) || !range) return "missing_instrument";
    if (v < range.min || v > range.max) return "out_of_range";
  }
  return null;
}

export interface WorseningFinding {
  readonly instrument: string;
  readonly baseline: number;
  readonly latest: number;
  readonly basis: "rise" | "absolute";
}

/**
 * Compares the latest scores with the baseline. Worse is a higher number for every instrument here. Returns one finding per
 * instrument that crossed its configured rise or absolute threshold. An instrument with no rule, or with no baseline or no later
 * score, produces nothing (there is nothing to compare).
 */
export function assessWorsening(
  worsening: Readonly<Record<string, TherapyWorseningRule>>,
  baseline: Readonly<Record<string, number>>,
  latest: Readonly<Record<string, number>>,
): WorseningFinding[] {
  const out: WorseningFinding[] = [];
  for (const [instrument, rule] of Object.entries(worsening)) {
    const last = latest[instrument];
    if (!isNum(last)) continue;
    if (isNum(rule.absolute_at_least) && last >= rule.absolute_at_least) {
      out.push({ instrument, baseline: baseline[instrument] ?? last, latest: last, basis: "absolute" });
      continue;
    }
    const base = baseline[instrument];
    if (isNum(base) && isNum(rule.rise_at_least) && last - base >= rule.rise_at_least) {
      out.push({ instrument, baseline: base, latest: last, basis: "rise" });
    }
  }
  return out;
}

/**
 * Local-only diary note (device first). The text of a patient's diary never leaves the phone unless they choose to share it:
 * this guard is what a screen calls before it would send anything.
 */
export function mayUploadDiary(optedIn: boolean | null | undefined): boolean {
  return optedIn === true;
}
