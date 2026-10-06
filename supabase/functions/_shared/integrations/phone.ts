import type { ProviderResult } from "./result.ts";

/**
 * Phone bridge (S21, OQ-126 and OQ-131): the last step of the consultation ladder. The server rings the patient and the
 * clinician from a number Tarragon owns and joins the two calls, so neither person ever sees the other's number. The
 * vendor is not chosen (OQ-131 is open: a Twilio Voice bridge, LiveKit SIP or a Nigerian carrier trunk); this file is the
 * interface and the mock only. Zoom call-out is deliberately not used: it costs roughly NGN 2,000 to 3,500 a minute.
 *
 * Rules every adapter must keep:
 * - A phone number goes IN and never comes back OUT: no result, error message or event carries either number.
 * - The two numbers must differ, and both must be E.164 (a Nigerian number looks like +234...).
 * - The bridge id is opaque and a bridge ends by itself after `maxMinutes`.
 * - Every method returns a `ProviderResult` and never throws.
 */
export type PhoneParty = "patient" | "clinician";
export type PhoneBridgeState = "ringing" | "connected" | "ended" | "failed";

export interface PhoneBridgeInput {
  /** Our own opaque reference for the encounter (a uuid), never a name. */
  readonly encounterRef: string;
  readonly patientPhone: string;
  readonly clinicianPhone: string;
  /** The bridge hangs up by itself after this long. */
  readonly maxMinutes: number;
}
export interface PhoneBridge {
  readonly bridgeId: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}
export interface PhoneBridgeStatus {
  readonly state: PhoneBridgeState;
  readonly patientAnswered: boolean;
  readonly clinicianAnswered: boolean;
}

export interface PhoneBridgeProvider {
  readonly name: string;
  readonly isMock: boolean;
  /** Rings both people. Repeating a call for the same encounter while a bridge is live returns that bridge. */
  connect(input: PhoneBridgeInput): Promise<ProviderResult<PhoneBridge>>;
  status(bridgeId: string): Promise<ProviderResult<PhoneBridgeStatus>>;
  /** Either person, or the system, can hang up. Hanging up twice is safe. */
  hangup(bridgeId: string, actingParty: PhoneParty | "system"): Promise<ProviderResult<{ endedAtMs: number }>>;
}

export const isE164 = (value: unknown): value is string => typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
export const MAX_BRIDGE_MINUTES = 60;
