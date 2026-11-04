import type { MessageKey } from "@tarragon/i18n";
import type { TaskAnswer } from "./parse";

/** Care Circle P3: what the patient reads for one named person on a request, exactly as the web words it. */
export function taskAnswerKey(answer: TaskAnswer | null): MessageKey {
  return answer === "can_help" ? "cctools.tasks.answer.can_help" : answer === "cannot_help" ? "cctools.tasks.answer.cannot_help" : "cctools.tasks.answer.waiting";
}

/** Tick or untick one person (by membership id) for a request. Order kept; never a repeat. */
export function toggleRecipient(current: readonly string[], memberId: string): string[] {
  return current.includes(memberId) ? current.filter((x) => x !== memberId) : [...current, memberId];
}
