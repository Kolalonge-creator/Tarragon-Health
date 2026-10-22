import { constantTimeEqual, hmacHex } from "./crypto.ts";

/**
 * Who is allowed to say they entered the call (S21 follow-up, OQ-160). Server side only: it needs the server's secret and WebCrypto, so
 * it is kept apart from the signal mapping in consultation-call.ts that the browser also loads.
 *
 * A vendor SDK lets the client choose its own display name, so a name proves nothing (a patient could call themselves
 * "clinician"). The server instead gives each person an opaque participant key for the one encounter and role, an HMAC of
 * `encounter:role` under a server-only secret. The key travels to the vendor as the SDK's customer key and comes back in the
 * vendor's webhook. Only the server can mint or check one, and a key for one encounter or role is useless for another.
 */
export type PersonRole = "patient" | "clinician";

const KEY_DOMAIN = "tarragon.participant.v1";
/** One role letter plus 34 hex characters: 35 characters, short of 36 characters, which is as long as a vendor customer key is believed to be allowed (not confirmed in the vendor's docs). */
const KEY_HEX_CHARS = 34;

export async function participantKey(secret: string, encounterId: string, role: PersonRole): Promise<string> {
  const mac = await hmacHex("SHA-256", secret, `${KEY_DOMAIN}:${encounterId}:${role}`);
  return `${role === "clinician" ? "c" : "p"}${mac.slice(0, KEY_HEX_CHARS)}`;
}

/** The role this key was minted for on this encounter, or null when it was not minted by us for it. */
export async function roleFromParticipantKey(secret: string, encounterId: string, key: string): Promise<PersonRole | null> {
  const roles: readonly PersonRole[] = ["patient", "clinician"];
  let found: PersonRole | null = null;
  // Both are always compared, so how long the check takes does not say which role matched first.
  for (const role of roles) {
    if (constantTimeEqual(key, await participantKey(secret, encounterId, role))) found = role;
  }
  return found;
}

// ---- caregiver keys (CGJ) ----
//
// A caregiver invited into one call gets a key bound to ONE pass (the invite), not to a role: the pass id is part of the MAC, so a key
// cannot be carried to another call, another caregiver, or a pass that was removed and replaced. It starts with "g" so the presence handler
// can tell it from a patient or clinician key without trying every pass first. The server only ever compares against the passes of the
// encounter the room belongs to.
const CAREGIVER_DOMAIN = "tarragon.participant.v1.caregiver";

export async function caregiverParticipantKey(secret: string, encounterId: string, passId: string): Promise<string> {
  const mac = await hmacHex("SHA-256", secret, `${CAREGIVER_DOMAIN}:${encounterId}:${passId}`);
  return `g${mac.slice(0, KEY_HEX_CHARS)}`;
}

/** The pass this key was minted for on this encounter, or null. Every candidate is compared, so timing does not say which one matched. */
export async function passFromCaregiverKey(secret: string, encounterId: string, key: string, passIds: readonly string[]): Promise<string | null> {
  let found: string | null = null;
  for (const id of passIds) {
    if (constantTimeEqual(key, await caregiverParticipantKey(secret, encounterId, id))) found = id;
  }
  return found;
}
