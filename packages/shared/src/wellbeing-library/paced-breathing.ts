/**
 * Paced breathing timeline (S57, function 10.7). Pure and deterministic: no clock, no randomness.
 * The pattern (seconds per phase) comes from a REVIEWED library item and the bounds from PROPOSED config
 * (`media_library.config`); nothing here chooses a breathing rate. No effect on health is claimed anywhere.
 * S33's BRE-01 is not on this base; when it merges its renderer can replace the component and keep this seam.
 */
export type BreathPhase = "inhale" | "hold" | "exhale";

export interface BreathingPattern {
  readonly inhale_s: number;
  readonly hold_s?: number;
  readonly exhale_s: number;
}

export interface BreathingBounds {
  readonly min_seconds: number;
  readonly max_seconds: number;
  readonly max_phase_seconds: number;
}

export interface BreathStep {
  readonly phase: BreathPhase;
  readonly seconds: number;
}

/** Returns a problem key or null. The database enforces the same rules when an item is published. */
export function breathingProblem(pattern: BreathingPattern, totalSeconds: number, bounds: BreathingBounds): string | null {
  const phases = [pattern.inhale_s, pattern.hold_s ?? 0, pattern.exhale_s];
  if (!(pattern.inhale_s > 0) || !(pattern.exhale_s > 0)) return "phase_missing";
  if (phases.some((p) => !Number.isFinite(p) || p < 0 || p > bounds.max_phase_seconds)) return "phase_too_long";
  if (!Number.isFinite(totalSeconds) || totalSeconds < bounds.min_seconds || totalSeconds > bounds.max_seconds) return "length_out_of_bounds";
  return null;
}

/** One breath cycle as steps (a zero-length hold is left out). */
export function breathCycle(pattern: BreathingPattern): BreathStep[] {
  const steps: BreathStep[] = [{ phase: "inhale", seconds: pattern.inhale_s }];
  if ((pattern.hold_s ?? 0) > 0) steps.push({ phase: "hold", seconds: pattern.hold_s as number });
  steps.push({ phase: "exhale", seconds: pattern.exhale_s });
  return steps;
}

export interface BreathPosition {
  readonly done: boolean;
  readonly phase: BreathPhase | null;
  /** Whole seconds left in the current phase, counting down (never below 1 while running). */
  readonly secondsLeft: number;
  /** 0 to 1 through the current phase. */
  readonly progress: number;
  readonly cycle: number;
  readonly remainingSeconds: number;
}

export function breathPositionAt(pattern: BreathingPattern, totalSeconds: number, elapsedSeconds: number): BreathPosition {
  const cycle = breathCycle(pattern);
  const cycleLen = cycle.reduce((a, s) => a + s.seconds, 0);
  const elapsed = Math.max(0, elapsedSeconds);
  if (elapsed >= totalSeconds || cycleLen <= 0) {
    return { done: true, phase: null, secondsLeft: 0, progress: 1, cycle: 0, remainingSeconds: 0 };
  }
  const inCycle = elapsed % cycleLen;
  const cycleIndex = Math.floor(elapsed / cycleLen);
  let acc = 0;
  for (const s of cycle) {
    if (inCycle < acc + s.seconds) {
      const into = inCycle - acc;
      return {
        done: false,
        phase: s.phase,
        secondsLeft: Math.max(1, Math.ceil(s.seconds - into)),
        progress: into / s.seconds,
        cycle: cycleIndex,
        remainingSeconds: Math.ceil(totalSeconds - elapsed),
      };
    }
    acc += s.seconds;
  }
  return { done: true, phase: null, secondsLeft: 0, progress: 1, cycle: cycleIndex, remainingSeconds: 0 };
}
