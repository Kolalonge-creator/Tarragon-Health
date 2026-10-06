import type { MessageKey, MessageParams } from "@tarragon/i18n";
import { QUESTION_MIN_LENGTH } from "./types";

export interface MappedError {
  key: MessageKey;
  params?: MessageParams;
}

/** Map a database error message to a patient-facing string key, by message prefix. Unknown errors are generic. */
export function mapWrittenQuestionError(message: string | null | undefined): MappedError {
  const m = (message ?? "").trim();
  if (m.startsWith("Written messages to your care team are part of Membership")) return { key: "wq.members_only" };
  if (m.startsWith("Written questions are for adults")) return { key: "wq.adults_only" };
  if (m.startsWith("You have used your written messages")) return { key: "wq.allowance.none" };
  if (/\b(at least|characters|length)\b/i.test(m)) {
    return { key: "wq.error.length", params: { min: QUESTION_MIN_LENGTH } };
  }
  return { key: "wq.error.generic" };
}
