import type { BreathingPhase, BreathingState } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";

/** What the BRE-01 screen draws and says for a moment in the session. Pure, so it is tested without a screen or a clock. */

export const phaseKey = (phase: BreathingPhase): MessageKey => (phase === "in" ? "breathing.in" : "breathing.out");

/** Circle scale for a fill of 0 (empty) to 1 (full). Never collapses to nothing, so the shape stays visible. */
export const pacerScale = (fill: number): number => 0.55 + 0.45 * Math.min(1, Math.max(0, fill));

/** Reduced motion: the guide steps between two sizes at each phase change instead of growing and shrinking. */
export const steppedScale = (phase: BreathingPhase): number => (phase === "in" ? 1 : 0.55);

/** Speak only when the phase changes (or at the start). A running count read out every second would drown the exercise. */
export function shouldAnnounce(prev: BreathingState | null, next: BreathingState): boolean {
  if (next.finished) return false;
  return prev === null || prev.phase !== next.phase || prev.breath !== next.breath;
}

/** Cues (haptic taps) whose moment falls after `afterMs` and up to and including `uptoMs`. `afterMs` null includes time zero. */
export function dueCues<T extends { readonly atMs: number }>(cues: readonly T[], afterMs: number | null, uptoMs: number): T[] {
  return cues.filter((c) => c.atMs <= uptoMs && (afterMs === null ? true : c.atMs > afterMs));
}

/** The progress label, e.g. "Breath 3 of 18". */
export const breathParams = (s: Pick<BreathingState, "breath" | "totalBreaths">): { n: number; total: number } => ({ n: s.breath, total: s.totalBreaths });
