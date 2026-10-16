/**
 * The notice to a patient's own consented emergency contact (S85-D3, changed 2026-10-16 by founder decision OQ-333: there is NO SMS
 * exception any more). A patient triggers an emergency; if their emergency contact is also a Tarragon account (matched in
 * the database by a CONFIRMED phone number, see private.alert_emergency_contact_copies) the contact gets a push, an in-app notice
 * and, where an address exists, an email, with no condition, result or reading. Pure code: no network, clock or database.
 */

/** Used when the payload carries no usable name. The DB function's own placeholder is treated as "no name". */
const NO_NAME_PLACEHOLDER = "someone who lists you as their emergency contact";

export function emergencyContactName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length === 0 || name === NO_NAME_PLACEHOLDER) return "them";
  return name.length > 60 ? `${name.slice(0, 59)}\u2026` : name;
}

/** Exactly: "Please call {name} now." (the sender adds the brand). */
export function emergencyContactText(rawName: unknown): string {
  return `Please call ${emergencyContactName(rawName)} now.`;
}

/** A copy for the contact (push, email, in-app) only needs the patient's consent still standing; it is re-checked when each copy is sent. */
export function checkFanoutRowConsent(owner: { readonly emergency_contact_consent: boolean | null } | null): "ok" | "consent_withdrawn" {
  return owner?.emergency_contact_consent === true ? "ok" : "consent_withdrawn";
}
