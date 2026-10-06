import type { ProviderResult } from "./result.ts";

/**
 * Video (spec section 10, decision D-07): the interface and a mock only. No vendor is chosen and none is wired until M5
 * (candidates Daily, Agora, 100ms). Rules every adapter must keep:
 * - A room and a token are opaque. Neither carries a name, a condition or any patient detail; the link between a
 *   room and an encounter lives in our database.
 * - A token is short-lived and role-scoped. Only a clinician token can end a room.
 * - Connection quality is reported as events so the app can fall back to audio only (low bandwidth is normal here).
 */
export type VideoRole = "patient" | "clinician" | "observer";
export type ConnectionQuality = "good" | "fair" | "poor" | "lost";

export interface CreateRoomInput {
  /** Our own opaque reference for the encounter (a uuid), never a name. */
  readonly encounterRef: string;
  /** Epoch ms after which the room can no longer be joined. */
  readonly expiresAtMs: number;
}
export interface VideoRoom {
  readonly roomId: string;
  readonly expiresAtMs: number;
}
export interface JoinTokenInput {
  readonly roomId: string;
  readonly role: VideoRole;
  /** Opaque participant id (a uuid). */
  readonly identity: string;
  readonly ttlSeconds: number;
}
export interface JoinToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export type VideoEvent =
  | { readonly kind: "participant_joined"; readonly roomId: string; readonly role: VideoRole; readonly atMs: number }
  | { readonly kind: "participant_left"; readonly roomId: string; readonly role: VideoRole; readonly atMs: number }
  | {
      readonly kind: "quality";
      readonly roomId: string;
      readonly role: VideoRole;
      readonly atMs: number;
      readonly quality: ConnectionQuality;
      readonly bitrateKbps?: number;
    }
  | { readonly kind: "room_ended"; readonly roomId: string; readonly atMs: number };

export interface VideoProvider {
  readonly name: string;
  readonly isMock: boolean;
  createRoom(input: CreateRoomInput): Promise<ProviderResult<VideoRoom>>;
  /**
   * `actingRole` is what the CALLER asserts; the adapter cannot verify it. It is a safety net against a coding slip, not
   * authorisation: the caller must first check the signed-in user holds the clinician assignment for this encounter (INV-12).
   */
  joinToken(input: JoinTokenInput): Promise<ProviderResult<JoinToken>>;
  endRoom(roomId: string, actingRole: VideoRole): Promise<ProviderResult<{ endedAtMs: number }>>;
  /**
   * In-process events for a room, for example connection quality reported by the vendor's client SDK on the device.
   * Returns an unsubscribe function. Presence and end-of-room events that only the vendor's servers know come through
   * `parseWebhook` instead.
   */
  subscribe(roomId: string, handler: (event: VideoEvent) => void): () => void;
  /**
   * Checks the vendor's webhook signature on the RAW body, then maps a presence or room event to ours. An event type
   * we do not act on is `ok(null)`. A bad signature is `invalid_signature`. Never throws.
   */
  parseWebhook(rawBody: string, headers: Readonly<Record<string, string | null>>, nowMs: number): Promise<ProviderResult<VideoEvent | null>>;
}

/** Roles travel as the participant's display label, which is all a vendor SDK lets us attach to a person. Never a name. */
export const ROLE_LABELS: readonly VideoRole[] = ["patient", "clinician", "observer"];
export const asVideoRole = (label: unknown): VideoRole | null => (typeof label === "string" ? (ROLE_LABELS.find((r) => r === label) ?? null) : null);

export const MAX_TOKEN_TTL_SECONDS = 4 * 60 * 60;

// ---- audio-only fallback (pure) ----

/** PROPOSED values: the `video.audio_fallback` entry of the proposed-config registry. Never hard-code these. */
export type AudioFallbackPolicy = {
  /** Consecutive poor samples before the call drops to audio only. */
  readonly poorSamplesToDowngrade: number;
  /** Consecutive good samples before the app offers video again (the patient taps; it never switches back by itself). */
  readonly goodSamplesToOfferVideo: number;
  /** A bitrate under this counts as poor even if the vendor says fair. */
  readonly poorBelowKbps: number;
};

export interface AudioFallbackState {
  readonly mode: "video" | "audio_only";
  readonly poorStreak: number;
  readonly goodStreak: number;
  readonly videoOffered: boolean;
}
export const INITIAL_AUDIO_FALLBACK: AudioFallbackState = { mode: "video", poorStreak: 0, goodStreak: 0, videoOffered: false };

export interface QualitySample {
  readonly quality: ConnectionQuality;
  readonly bitrateKbps?: number;
}

export function isPoorSample(sample: QualitySample, policy: AudioFallbackPolicy): boolean {
  if (sample.quality === "poor" || sample.quality === "lost") return true;
  return sample.bitrateKbps !== undefined && sample.bitrateKbps < policy.poorBelowKbps;
}

/**
 * One step of the fallback decision. One bad sample never downgrades; a sustained run does. In audio-only mode a sustained
 * good run sets `videoOffered` so the app can ask the patient; it does not switch back by itself, because switching
 * back spends the patient's data.
 */
export function stepAudioFallback(
  state: AudioFallbackState,
  sample: QualitySample,
  policy: AudioFallbackPolicy,
): { readonly state: AudioFallbackState; readonly change: "to_audio_only" | "offer_video" | null } {
  const poor = isPoorSample(sample, policy);
  const poorStreak = poor ? state.poorStreak + 1 : 0;
  const goodStreak = poor ? 0 : state.goodStreak + 1;
  if (state.mode === "video") {
    if (poorStreak >= policy.poorSamplesToDowngrade) {
      return { state: { mode: "audio_only", poorStreak: 0, goodStreak: 0, videoOffered: false }, change: "to_audio_only" };
    }
    return { state: { ...state, poorStreak, goodStreak }, change: null };
  }
  if (!state.videoOffered && goodStreak >= policy.goodSamplesToOfferVideo) {
    return { state: { ...state, poorStreak, goodStreak, videoOffered: true }, change: "offer_video" };
  }
  // A bad sample withdraws an offer that has not been taken up yet.
  return { state: { ...state, poorStreak, goodStreak, videoOffered: poor ? false : state.videoOffered }, change: null };
}
