/**
 * MSK pain programmes (S96): the pure rules shared by web and phone. Deterministic (INV-01): no model, no clock read, no I/O.
 *
 * What is here: which exercises show today (the daily cap, the activity-gate intensity ceiling, the lighter step-down plan), the
 * "too hard" easier-version rule, readers for what the database returns, and the PEG summary. What is not here: the red-flag screen
 * (that is `evaluateEntryScreen` in therapy-programmes.ts, run by the database on every flare-up and every session) and any clinical
 * judgement beyond the CMO's rows.
 */
import type { Json } from "./database.types";
import type { MskExerciseRow, MskIntensity } from "./therapy-content/msk-drafts";
import { MSK_PROGRAMME_CODES, MSK_SETTINGS, type MskProgrammeCode, type MskSettings } from "./proposed-config/msk-config-data";
import { THERAPY_ROUTE_PRIORITY, type TherapyRoute } from "./therapy-programmes";

export { MSK_PROGRAMME_CODES };
export type { MskProgrammeCode, MskSettings };

export function isMskProgrammeCode(v: unknown): v is MskProgrammeCode {
  return typeof v === "string" && (MSK_PROGRAMME_CODES as readonly string[]).includes(v);
}

const isRecord = (v: unknown): v is Record<string, Json | undefined> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The activity safety gate answer, reduced to what the exercise list needs. Anything unreadable is gentle only (never permissive). */
export interface MskGate {
  readonly decision: "allow" | "restrict" | "rest";
  readonly maxIntensity: "none" | "gentle" | "moderate" | "vigorous";
}

export const MSK_GATE_FAIL_CLOSED: MskGate = { decision: "restrict", maxIntensity: "gentle" };

export function readMskGate(raw: unknown): MskGate {
  if (!isRecord(raw)) return MSK_GATE_FAIL_CLOSED;
  const d = raw.decision;
  const m = raw.max_intensity;
  if (d !== "allow" && d !== "restrict" && d !== "rest") return MSK_GATE_FAIL_CLOSED;
  if (m !== "none" && m !== "gentle" && m !== "moderate" && m !== "vigorous") return MSK_GATE_FAIL_CLOSED;
  if ((d === "rest") !== (m === "none")) return MSK_GATE_FAIL_CLOSED;
  return { decision: d, maxIntensity: m };
}

export interface MskStepDown {
  /** ISO date (yyyy-mm-dd), last day of the lighter plan, inclusive. */
  readonly until: string;
}

export interface MskStartExtras {
  readonly exercises: readonly MskExerciseRow[];
  readonly gate: MskGate;
  readonly stepDown: MskStepDown | null;
  /** Days with a full set recorded for this session (week), and the number needed to finish it. */
  readonly daysDone: number;
  readonly daysNeeded: number;
}

function readExercise(v: unknown): MskExerciseRow | null {
  if (!isRecord(v)) return null;
  const key = str(v.key);
  const name = str(v.name);
  const dose = str(v.dose);
  const intensity = v.intensity;
  if (!key || !name || !dose || (intensity !== "gentle" && intensity !== "moderate")) return null;
  if (!Array.isArray(v.steps) || !v.steps.every((x): x is string => typeof x === "string")) return null;
  return {
    key,
    name,
    intensity: intensity as MskIntensity,
    steps: v.steps,
    dose,
    easier: str(v.easier) ?? "",
    harder: str(v.harder) ?? "",
    stop_if: str(v.stop_if) ?? "",
    alt: str(v.alt) ?? "",
  };
}

/** Reads the MSK part of `start_msk_session`. Null when absent or malformed (the screen then shows the session text only). */
export function readMskExtras(raw: unknown): MskStartExtras | null {
  if (!isRecord(raw) || !Array.isArray(raw.exercises)) return null;
  const exercises: MskExerciseRow[] = [];
  for (const e of raw.exercises) {
    const row = readExercise(e);
    if (!row) return null;
    exercises.push(row);
  }
  const stepRaw = raw.step_down;
  const until = isRecord(stepRaw) ? str(stepRaw.until) : null;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    exercises,
    gate: readMskGate(raw.activity_gate),
    stepDown: until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? { until } : null,
    daysDone: num(raw.days_done, 0),
    daysNeeded: num(raw.days_needed, MSK_SETTINGS.min_days_to_complete),
  };
}

export interface DailySet {
  readonly exercises: readonly MskExerciseRow[];
  /** true when the day's list was shortened or made gentler (gate or step-down). */
  readonly lighter: boolean;
  readonly reason: "none" | "activity_gate" | "step_down";
}

const RANK: Record<string, number> = { none: -1, gentle: 0, moderate: 1, vigorous: 2 };

/** Whether a step-down is still running on `today` (ISO date, supplied by the caller so this stays pure). */
export function stepDownActive(stepDown: MskStepDown | null, today: string): boolean {
  return stepDown !== null && today <= stepDown.until;
}

/**
 * The exercises to show today. The cap applies first; the gate then removes anything above its ceiling; a running step-down keeps only
 * gentle exercises and at most the configured number. A rest answer shows nothing. A list that would end up empty keeps the first gentle
 * exercise (every written set has one), so "gentle only" never means "nothing to do" unless the gate says rest.
 */
export function selectDailySet(
  planned: readonly MskExerciseRow[],
  opts: { gate: MskGate; stepDownRunning: boolean; settings?: MskSettings },
): DailySet {
  const settings = opts.settings ?? MSK_SETTINGS;
  if (opts.gate.decision === "rest") return { exercises: [], lighter: true, reason: "activity_gate" };
  const ceiling = RANK[opts.gate.maxIntensity] ?? 0;
  const capped = planned.slice(0, settings.daily_exercise_cap);
  let list = capped.filter((e) => (RANK[e.intensity] ?? 99) <= ceiling);
  let reason: DailySet["reason"] = list.length < capped.length ? "activity_gate" : "none";
  if (opts.stepDownRunning) {
    list = list.filter((e) => e.intensity === "gentle").slice(0, settings.step_down_max_exercises);
    reason = "step_down";
  }
  if (list.length === 0) {
    const gentle = planned.find((e) => e.intensity === "gentle");
    if (gentle) list = [gentle];
  }
  return { exercises: list, lighter: reason !== "none", reason };
}

/** True when the last N ratings for one exercise are all "too hard", so the screen should offer the easier version. */
export function shouldOfferEasier(ratings: readonly number[], settings: MskSettings = MSK_SETTINGS): boolean {
  if (ratings.length < settings.too_hard_in_a_row) return false;
  return ratings.slice(-settings.too_hard_in_a_row).every((r) => r >= settings.too_hard_rating);
}

export function validDifficulty(v: unknown, settings: MskSettings = MSK_SETTINGS): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= settings.difficulty_min && v <= settings.difficulty_max;
}

/** PEG score: the mean of its three 0 to 10 items, one decimal. Null if any item is missing or out of range. */
export function pegScore(s: Readonly<Record<string, number | undefined>>): number | null {
  const a = s.peg_pain;
  const b = s.peg_enjoyment;
  const c = s.peg_activity;
  for (const x of [a, b, c]) if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 10) return null;
  return Math.round((((a as number) + (b as number) + (c as number)) / 3) * 10) / 10;
}

export type FlareUpOutcome =
  | { kind: "stopped"; route: TherapyRoute | null; taskFailed: boolean }
  | { kind: "step_down"; until: string }
  | { kind: "not_active" }
  | { kind: "unknown" };

export function readFlareUpOutcome(raw: unknown): FlareUpOutcome {
  if (!isRecord(raw)) return { kind: "unknown" };
  if (raw.status === "stopped") {
    const r = raw.route;
    const route = typeof r === "string" && (THERAPY_ROUTE_PRIORITY as readonly string[]).includes(r) ? (r as TherapyRoute) : null;
    return { kind: "stopped", route, taskFailed: raw.task_failed === true };
  }
  if (raw.status === "step_down") {
    const until = str(raw.until);
    return until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? { kind: "step_down", until } : { kind: "unknown" };
  }
  if (raw.status === "not_active") return { kind: "not_active" };
  return { kind: "unknown" };
}

/** `start_msk_session` answers "activity_rest" when the activity safety gate says rest: no session is opened and nothing is counted. */
/** The database function that finishes a week: pain programmes must go through `complete_msk_session` (the plain completion refuses them). */
export function completionRpcName(programmeCode: string | undefined): "complete_msk_session" | "complete_therapy_session" {
  return isMskProgrammeCode(programmeCode) ? "complete_msk_session" : "complete_therapy_session";
}

/** The database function that opens a week, same rule. */
export function startRpcName(programmeCode: string | undefined): "start_msk_session" | "start_therapy_session" {
  return isMskProgrammeCode(programmeCode) ? "start_msk_session" : "start_therapy_session";
}

export function isActivityRest(raw: unknown): boolean {
  return isRecord(raw) && raw.status === "activity_rest";
}

export interface MskCompleteBlock {
  readonly daysDone: number;
  readonly daysNeeded: number;
}

/** `complete_msk_session` answers "not_enough_days" until enough different days have a full set recorded. */
export function readNotEnoughDays(raw: unknown): MskCompleteBlock | null {
  if (!isRecord(raw) || raw.status !== "not_enough_days") return null;
  const d = raw.days_done;
  const n = raw.days_needed;
  return typeof d === "number" && typeof n === "number" ? { daysDone: d, daysNeeded: n } : null;
}
