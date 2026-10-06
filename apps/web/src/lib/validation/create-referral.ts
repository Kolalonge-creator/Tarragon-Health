import { z } from "zod";

/**
 * S24: a referral that leaves draft shares part of the patient's record with a specialist, so the clinician must confirm the patient
 * agreed to that first. A draft may be saved without it. The database refuses a non-draft clinician-initiated referral without a recorded
 * consent time (private.enforce_referral_consent_and_chase), so this is the early, friendly check; the timestamp it produces is what the
 * database stores as specialist_referrals.patient_consent_at.
 */
export const REFERRAL_CONSENT_LABEL = "The patient agreed to share the relevant parts of their record with the specialist";

export const referralConsentSchema = z.object({
  asDraft: z.boolean(),
  consentConfirmed: z.boolean(),
});

/**
 * The patient_consent_at to send: null for a draft (nothing leaves yet), `now` when a non-draft referral has the confirmation. Throws
 * the readable message when a non-draft referral has no confirmation, so a caller cannot send one by mistake.
 */
export function referralConsentTimestamp(input: { asDraft: boolean; consentConfirmed: boolean }, now: Date): string | null {
  const parsed = referralConsentSchema.parse(input);
  return parsed.asDraft ? null : submitConsentTimestamp(parsed.consentConfirmed, now);
}

/** For a draft that is being submitted: the consent time, or the readable refusal. */
export function submitConsentTimestamp(consentConfirmed: boolean, now: Date): string {
  if (!consentConfirmed) throw new Error("Confirm that the patient agreed to share their record before you submit this referral.");
  return now.toISOString();
}
