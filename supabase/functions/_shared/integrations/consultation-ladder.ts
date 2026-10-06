import { INITIAL_AUDIO_FALLBACK, stepAudioFallback, type AudioFallbackPolicy, type AudioFallbackState, type QualitySample } from "./video.ts";

/**
 * The consultation fallback ladder (S21, OQ-126): video, then audio only, then a phone call. Pure code, no vendor and no
 * clock of its own: every input carries the time it happened. The server owns the final mode; the pages and the vendor's
 * client SDK only report what they see.
 *
 * Rules (the values are PROPOSED config: `video.audio_fallback` and `consultations.policy`):
 * - Video to audio only uses the S14 step function: one bad sample never downgrades, a sustained run does.
 * - Audio only back to video is offered, never forced (it spends the patient's data). Only the patient takes it up.
 * - A lost connection starts a grace window and pauses the consultation clock. If it comes back inside the window nothing
 *   else changes. If the window ends first, the consultation moves to a phone call (the bridge dials both sides).
 * - The patient can ask for a phone call at any time.
 * - Phone is the end of the ladder: nothing moves it again.
 * - The pause is capped at the grace window, so a flapping connection cannot stretch a consultation without limit.
 */
export type MediaMode = "video" | "audio_only" | "phone";

export interface LadderPolicy extends AudioFallbackPolicy {
  /** How long a lost connection is given to come back before the call moves to the phone. */
  readonly reconnectGraceSeconds: number;
}

export interface LadderState {
  readonly mode: MediaMode;
  readonly fallback: AudioFallbackState;
  /** When the current loss began, or null when connected. */
  readonly lostAtMs: number | null;
  /** Total time the consultation clock has been paused by drops that recovered or ended in a phone call. */
  readonly pausedMs: number;
}
export const INITIAL_LADDER: LadderState = { mode: "video", fallback: INITIAL_AUDIO_FALLBACK, lostAtMs: null, pausedMs: 0 };

export type LadderInput =
  | { readonly kind: "sample"; readonly sample: QualitySample; readonly atMs: number }
  | { readonly kind: "lost"; readonly atMs: number }
  | { readonly kind: "restored"; readonly atMs: number }
  | { readonly kind: "tick"; readonly atMs: number }
  | { readonly kind: "patient_requests_phone"; readonly atMs: number }
  | { readonly kind: "patient_takes_video"; readonly atMs: number };

export type LadderAction = "to_audio_only" | "offer_video" | "to_video" | "grace_started" | "reconnected" | "to_phone";

export interface LadderStep {
  readonly state: LadderState;
  readonly action: LadderAction | null;
}

const graceMs = (policy: LadderPolicy): number => policy.reconnectGraceSeconds * 1000;
const none = (state: LadderState): LadderStep => ({ state, action: null });

export function stepLadder(state: LadderState, input: LadderInput, policy: LadderPolicy): LadderStep {
  if (state.mode === "phone") return none(state);

  switch (input.kind) {
    case "sample": {
      if (state.lostAtMs !== null) return none(state);
      const step = stepAudioFallback(state.fallback, input.sample, policy);
      const mode: MediaMode = step.change === "to_audio_only" ? "audio_only" : state.mode;
      return {
        state: { ...state, mode, fallback: step.state },
        action: step.change,
      };
    }
    case "lost":
      if (state.lostAtMs !== null) return none(state);
      return { state: { ...state, lostAtMs: input.atMs }, action: "grace_started" };
    case "restored": {
      if (state.lostAtMs === null) return none(state);
      const paused = Math.min(Math.max(input.atMs - state.lostAtMs, 0), graceMs(policy));
      // A reconnection starts the quality count again: samples from before the drop say nothing about the new link.
      return { state: { ...state, lostAtMs: null, pausedMs: state.pausedMs + paused, fallback: { ...state.fallback, poorStreak: 0, goodStreak: 0 } }, action: "reconnected" };
    }
    case "tick":
      if (state.lostAtMs === null || input.atMs - state.lostAtMs < graceMs(policy)) return none(state);
      return { state: { ...state, mode: "phone", lostAtMs: null, pausedMs: state.pausedMs + graceMs(policy) }, action: "to_phone" };
    case "patient_requests_phone": {
      const paused = state.lostAtMs === null ? 0 : Math.min(Math.max(input.atMs - state.lostAtMs, 0), graceMs(policy));
      return { state: { ...state, mode: "phone", lostAtMs: null, pausedMs: state.pausedMs + paused }, action: "to_phone" };
    }
    case "patient_takes_video":
      if (state.mode !== "audio_only" || !state.fallback.videoOffered || state.lostAtMs !== null) return none(state);
      return { state: { ...state, mode: "video", fallback: INITIAL_AUDIO_FALLBACK }, action: "to_video" };
  }
}

/** Time left in the consultation, with the clock paused while the connection is down (capped at the grace window). */
export function remainingSessionMs(startedAtMs: number, sessionMinutes: number, state: LadderState, nowMs: number, policy: LadderPolicy): number {
  const pausedNow = state.lostAtMs === null ? 0 : Math.min(Math.max(nowMs - state.lostAtMs, 0), graceMs(policy));
  return Math.max(0, startedAtMs + sessionMinutes * 60_000 + state.pausedMs + pausedNow - nowMs);
}
