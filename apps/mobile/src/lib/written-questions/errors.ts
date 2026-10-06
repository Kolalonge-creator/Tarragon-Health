import type { MessageKey } from "@tarragon/i18n";

/**
 * Maps the database's refusal text for a written question to a patient-facing
 * message key (S22). The server words are the contract; anything not recognised
 * becomes the generic "did not send, saved on this phone" message so a draft is
 * never lost behind an unexplained error.
 */
export function mapWrittenQuestionError(message: string | null | undefined): MessageKey {
  const text = (message ?? "").trim();
  if (text.includes("Written messages to your care team are part of Membership")) return "wq.members_only";
  if (text.includes("Written questions are for adults")) return "wq.adults_only";
  if (text.includes("You have used your written messages for this month")) return "wq.allowance.none";
  return "wq.error.generic";
}

/** True when the refusal is final for this patient (do not invite a retry of the same text). */
export function isTerminalWrittenQuestionError(key: MessageKey): boolean {
  return key === "wq.members_only" || key === "wq.adults_only" || key === "wq.allowance.none";
}

/**
 * Refusals that retrying the same text can never fix. The queue removes the item and gives the
 * text and photos back to the patient (never an automatic resend). Returns the reason key, or
 * null when the failure is a network or server problem that a retry may clear.
 */
export function finalRefusalKey(message: string | null | undefined): MessageKey | null {
  const text = (message ?? "").trim();
  if (text.includes("The question is too short or too long")) return "wq.error.length";
  const key = mapWrittenQuestionError(text);
  return isTerminalWrittenQuestionError(key) ? key : null;
}

/** A photo refusal that will never succeed (too big, too many): the photo is dropped, the question stays. */
export function isFinalPhotoRefusal(message: string | null | undefined): boolean {
  const text = message ?? "";
  return text.includes("photo too large") || text.includes("too many photos") || text.includes("closed to photos");
}
