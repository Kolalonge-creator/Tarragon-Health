/**
 * Guided breathing pacer for BRE-01 (spec 8.7 and Module 10). A pure model: it knows the pace and where in a
 * session a given moment falls, and nothing about timers, screens, sound or haptics. The screens drive it from
 * their own clock, so it runs offline and can be tested without time.
 *
 * The pace is a PROPOSED value (`breathing.bre01`, owner CMO) read through `getProposedConfig`; nothing here
 * hard-codes it. The exercise is a calm moment. It is never shown as a treatment for blood pressure and never
 * asks for a reading, so nothing in this file touches triage.
 */
import { getProposedConfig } from "./proposed-config";

export type BreathingVariant = "standard" | "gentle" | "short";
export type BreathingPhase = "in" | "out";

export interface BreathingPace {
  readonly inhaleSeconds: number;
  readonly exhaleSeconds: number;
  readonly durationSeconds: number;
}

export interface BreathingState {
  readonly phase: BreathingPhase;
  /** Whole seconds left in this phase, counting down to 1, for the on-screen count. */
  readonly secondsLeft: number;
  /** 0 to 1 through the current phase. */
  readonly phaseProgress: number;
  /** 0 (empty) to 1 (full): how full the pacer shape should be. Rises on the in-breath, falls on the out-breath. */
  readonly fill: number;
  /** 1-based breath number. */
  readonly breath: number;
  readonly totalBreaths: number;
  readonly elapsedMs: number;
  readonly finished: boolean;
}

export class BreathingConfigError extends Error {
  constructor(message: string) {
    super(`Invalid breathing configuration: ${message}`);
    this.name = "BreathingConfigError";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Hard limits that keep any configured pace inside the range the research supports (about 4 to 10 breaths a minute)
 * and out of breath-holding or hyperventilation territory. A value outside them is a configuration error, not a pace.
 */
export const BREATHING_LIMITS = {
  minBreathsPerMinute: 4,
  maxBreathsPerMinute: 10,
  minPhaseSeconds: 2,
  maxPhaseSeconds: 10,
  minDurationSeconds: 30,
  maxDurationSeconds: 900,
} as const;

export function breathsPerMinute(p: Pick<BreathingPace, "inhaleSeconds" | "exhaleSeconds">): number {
  return 60 / (p.inhaleSeconds + p.exhaleSeconds);
}

export function validatePace(p: BreathingPace): BreathingPace {
  const L = BREATHING_LIMITS;
  for (const [name, v] of [["inhaleSeconds", p.inhaleSeconds], ["exhaleSeconds", p.exhaleSeconds]] as const) {
    if (!isNum(v) || v < L.minPhaseSeconds || v > L.maxPhaseSeconds) {
      throw new BreathingConfigError(`${name} must be between ${L.minPhaseSeconds} and ${L.maxPhaseSeconds} seconds`);
    }
  }
  if (p.exhaleSeconds < p.inhaleSeconds) throw new BreathingConfigError("the out-breath must be at least as long as the in-breath");
  const bpm = breathsPerMinute(p);
  if (bpm < L.minBreathsPerMinute || bpm > L.maxBreathsPerMinute) {
    throw new BreathingConfigError(`pace of ${bpm.toFixed(1)} breaths a minute is outside ${L.minBreathsPerMinute} to ${L.maxBreathsPerMinute}`);
  }
  if (!isNum(p.durationSeconds) || p.durationSeconds < L.minDurationSeconds || p.durationSeconds > L.maxDurationSeconds) {
    throw new BreathingConfigError(`durationSeconds must be between ${L.minDurationSeconds} and ${L.maxDurationSeconds}`);
  }
  if (p.durationSeconds < p.inhaleSeconds + p.exhaleSeconds) throw new BreathingConfigError("a session must hold at least one breath");
  return p;
}

/** Turn the registry value into a validated pace for a variant. Throws on a missing or out-of-range field. */
export function paceFromConfig(raw: unknown, variant: BreathingVariant = "standard"): BreathingPace {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new BreathingConfigError("value is not an object");
  const r = raw as Record<string, unknown>;
  const need = (k: string): number => {
    const v = r[k];
    if (!isNum(v)) throw new BreathingConfigError(`${k} is missing or not a number`);
    return v;
  };
  const gentle = variant === "gentle";
  return validatePace({
    inhaleSeconds: need(gentle ? "gentle_inhale_seconds" : "inhale_seconds"),
    exhaleSeconds: need(gentle ? "gentle_exhale_seconds" : "exhale_seconds"),
    durationSeconds: need(variant === "short" ? "short_duration_seconds" : "duration_seconds"),
  });
}

/** The BRE-01 pace in force today, with the version used so a session can record it (INV-16). */
export function bre01Pace(variant: BreathingVariant = "standard", asOf?: string): { pace: BreathingPace; configVersion: number } {
  const c = getProposedConfig("breathing.bre01", asOf);
  return { pace: paceFromConfig(c.value, variant), configVersion: c.version };
}

/** Whole breaths in a session. A partial breath at the end is dropped so the session ends on a full out-breath. */
export function totalBreaths(p: BreathingPace): number {
  return Math.max(1, Math.floor(p.durationSeconds / (p.inhaleSeconds + p.exhaleSeconds)));
}

export function sessionMs(p: BreathingPace): number {
  return totalBreaths(p) * (p.inhaleSeconds + p.exhaleSeconds) * 1000;
}

/** Where the session is at `elapsedMs`. Negative time counts as the start. */
export function stateAt(p: BreathingPace, elapsedMs: number): BreathingState {
  const cycleMs = (p.inhaleSeconds + p.exhaleSeconds) * 1000;
  const inMs = p.inhaleSeconds * 1000;
  const total = totalBreaths(p);
  const end = sessionMs(p);
  const t = Math.max(0, elapsedMs);
  if (t >= end) {
    return { phase: "out", secondsLeft: 0, phaseProgress: 1, fill: 0, breath: total, totalBreaths: total, elapsedMs: end, finished: true };
  }
  const breath = Math.floor(t / cycleMs) + 1;
  const within = t - (breath - 1) * cycleMs;
  if (within < inMs) {
    const progress = within / inMs;
    return { phase: "in", secondsLeft: Math.ceil((inMs - within) / 1000), phaseProgress: progress, fill: progress, breath, totalBreaths: total, elapsedMs: t, finished: false };
  }
  const outMs = cycleMs - inMs;
  const progress = (within - inMs) / outMs;
  return { phase: "out", secondsLeft: Math.ceil((cycleMs - within) / 1000), phaseProgress: progress, fill: 1 - progress, breath, totalBreaths: total, elapsedMs: t, finished: false };
}

/** The moments a cue (a haptic pulse, a sound) should fire: the start of every in-breath and every out-breath. */
export function cueSchedule(p: BreathingPace): readonly { readonly atMs: number; readonly phase: BreathingPhase }[] {
  const cues: { atMs: number; phase: BreathingPhase }[] = [];
  const cycleMs = (p.inhaleSeconds + p.exhaleSeconds) * 1000;
  for (let i = 0; i < totalBreaths(p); i++) {
    cues.push({ atMs: i * cycleMs, phase: "in" });
    cues.push({ atMs: i * cycleMs + p.inhaleSeconds * 1000, phase: "out" });
  }
  return cues;
}

/**
 * Stop rules shown with the exercise (strings live in `@tarragon/i18n`). Kept as codes so a screen can never
 * show a session without the safety card: `acknowledged` must be true before a session starts.
 */
export const BREATHING_STOP_REASONS = ["dizzy", "tingling", "chest_pain", "new_breathlessness", "palpitations"] as const;
export type BreathingStopReason = (typeof BREATHING_STOP_REASONS)[number];

export function mayStartSession(acknowledgedSafetyCard: boolean): boolean {
  return acknowledgedSafetyCard === true;
}
