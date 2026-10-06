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
  /** Recording is always off (S21, OQ-128). An adapter that cannot guarantee it must refuse to create the room. */
  readonly recording: "off";
}
/** What the participant asks for on joining. A vendor link cannot always force it; see `audioOnlyEnforced`. */
export type RequestedMedia = "video" | "audio_only";
export interface JoinLinkInput {
  readonly roomId: string;
  readonly role: VideoRole;
  readonly mediaMode: RequestedMedia;
}
export interface JoinLink {
  /** Issued on demand and never stored: it can carry a passcode or a host key. */
  readonly url: string;
  readonly expiresAtMs: number;
  readonly mediaMode: RequestedMedia;
  /** True only when the vendor itself keeps the camera off. A plain meeting link cannot, so the app also tells the person. */
  readonly audioOnlyEnforced: boolean;
}
/**
 * The phone fallback (S21, OQ-131 revised): the same room, joined by an ordinary phone call to a number the vendor publishes, so it
 * needs no data and no app. The person dials, enters the meeting id and passcode, and is in the same call as the clinician. Fetched
 * from the vendor each time and never stored: the passcode is a credential for the room.
 */
export interface DialInNumber {
  /** Two-letter country code. Only numbers for the country the patient is in are returned. */
  readonly country: string;
  /** E.164 where the vendor gives one, otherwise as published. Shown to the person; never logged. */
  readonly number: string;
  readonly city: string | null;
  readonly kind: "toll" | "toll_free";
}
export interface DialIn {
  readonly numbers: readonly DialInNumber[];
  /** The id to type after dialling, digits only. */
  readonly meetingId: string;
  /** Keypad passcode for a phone caller, or null when the room needs none. */
  readonly passcode: string | null;
  readonly expiresAtMs: number;
}
export interface DialInInput {
  readonly roomId: string;
  /** Two-letter country code to list numbers for (Nigeria for this platform). */
  readonly country: string;
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
  /**
   * The link-based join (S21, OQ-126): what a person opens when the vendor's app, not our own SDK, runs the call. Fetched
   * from the vendor each time and never stored. The clinician's link is the host link; a patient's is not.
   */
  joinLink(input: JoinLinkInput): Promise<ProviderResult<JoinLink>>;
  /** Numbers to ring into the same room by phone. `not_found` when the vendor offers none for the country (the app then says so). */
  dialIn(input: DialInInput): Promise<ProviderResult<DialIn>>;
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
