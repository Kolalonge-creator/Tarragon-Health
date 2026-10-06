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
