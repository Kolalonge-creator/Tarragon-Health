/**
 * The calm tool (S56b, function 4): a scripted, offline grounding flow for acute anxiety. Pure code: no network, no model, no clock of its own,
 * no storage and no logging. The words are the `panic.*` strings in packages/i18n (a fingerprint of them is what the CMO attests); the pace is
 * PROPOSED config `wellbeing.panic_tool`.
 *
 * The flow: intro (one reassuring line) -> slow breathing (reuses the paced-breathing timeline) -> 5-4-3-2-1 grounding -> done. The way out to the
 * crisis card is a screen concern (always visible, every stage); nothing here can hide it. Nothing is written anywhere unless the person taps
 * "tell my care team" afterwards, which is the existing hand-off.
 */
import { getProposedConfig } from "../proposed-config";
import { breathPositionAt, type BreathPhase } from "../wellbeing-library/paced-breathing";

export type PanicToolConfig = {
  readonly content_version: number;
  readonly inhale_seconds: number;
  readonly exhale_seconds: number;
  readonly total_seconds: number;
  readonly grounding_counts: readonly number[];
}

export const panicToolConfig = (): PanicToolConfig => getProposedConfig<PanicToolConfig>("wellbeing.panic_tool").value;

export type PanicStage = "intro" | "breathing" | "grounding" | "done";
export interface PanicState {
  readonly stage: PanicStage;
  /** Which grounding step, 0-based. Only meaningful in the grounding stage. */
  readonly step: number;
}
export type PanicEvent = "start" | "breathing_finished" | "skip" | "next" | "restart";

export const initialPanicState = (): PanicState => ({ stage: "intro", step: 0 });

/** One catalogue key per grounding count: 5, 4, 3, 2, 1. */
export const groundingKey = (count: number): string => `panic.ground_${count}`;

/** The pure state machine. An event that does not apply to the stage leaves the state unchanged, so a stray tap can never skip help. */
export function advancePanic(state: PanicState, event: PanicEvent, cfg: PanicToolConfig = panicToolConfig()): PanicState {
  const last = cfg.grounding_counts.length - 1;
  switch (event) {
    case "start":
      return state.stage === "intro" ? { stage: "breathing", step: 0 } : state;
    case "breathing_finished":
    case "skip":
      return state.stage === "breathing" ? { stage: "grounding", step: 0 } : state;
    case "next":
      if (state.stage !== "grounding") return state;
      return state.step >= last ? { stage: "done", step: last } : { stage: "grounding", step: state.step + 1 };
    case "restart":
      return state.stage === "done" ? { stage: "breathing", step: 0 } : state;
  }
}

export interface PanicBreathView {
  readonly done: boolean;
  readonly phase: BreathPhase | null;
  readonly secondsLeft: number;
  /** 0 to 1 through the current phase. */
  readonly progress: number;
  /** 1-based breath number and the total, for "Breath 3 of 6". */
  readonly breath: number;
  readonly totalBreaths: number;
}

/** Where the breathing guide is `elapsedSeconds` after it started. A cycle is one breath in and one out; the exercise ends after whole cycles. */
export function panicBreathView(elapsedSeconds: number, cfg: PanicToolConfig = panicToolConfig()): PanicBreathView {
  const cycle = cfg.inhale_seconds + cfg.exhale_seconds;
  const totalBreaths = Math.max(1, Math.floor(cfg.total_seconds / cycle));
  const total = totalBreaths * cycle;
  const pos = breathPositionAt({ inhale_s: cfg.inhale_seconds, exhale_s: cfg.exhale_seconds }, total, elapsedSeconds);
  return {
    done: pos.done,
    phase: pos.phase,
    secondsLeft: pos.secondsLeft,
    progress: pos.progress,
    breath: Math.min(totalBreaths, pos.cycle + 1),
    totalBreaths,
  };
}

/** Circle size for the guide: grows while breathing in, shrinks while breathing out. Never below 0.6 so the shape stays visible. */
export function panicCircleScale(view: PanicBreathView): number {
  if (view.phase === "inhale") return 0.6 + 0.4 * view.progress;
  if (view.phase === "exhale") return 1 - 0.4 * view.progress;
  return 0.6;
}

/** Reduced motion: the guide steps between two sizes at each phase change instead of growing and shrinking. */
export const panicSteppedScale = (phase: BreathPhase | null): number => (phase === "inhale" ? 1 : 0.6);

/** Every `panic.*` key the flow uses, so a test can prove none is missing from the catalogue and the fingerprint covers them all. */
export function panicKeysUsed(cfg: PanicToolConfig = panicToolConfig()): string[] {
  return [
    "panic.button", "panic.dialog_label", "panic.title", "panic.intro_1", "panic.intro_2", "panic.start", "panic.breathe_in", "panic.breathe_out",
    "panic.breath_count", "panic.skip", "panic.text_mode", "panic.ground_intro", ...cfg.grounding_counts.map(groundingKey), "panic.step_of", "panic.next",
    "panic.done_title", "panic.done_line", "panic.again", "panic.close", "panic.tell_team", "panic.tell_team_note", "panic.not_saved", "panic.danger",
  ];
}
