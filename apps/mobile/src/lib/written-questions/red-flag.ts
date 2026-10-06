import { screenWrittenQuestion } from "@tarragon/clinical";

/**
 * The on-device red-flag gate for a written question (INV-01, INV-06). Pure and
 * deterministic, so it works with no signal: the same phrase list the database
 * repeats on arrival. A hit holds the send until the patient has seen the
 * "go to the nearest hospital now" guidance and chosen to go on.
 */
export function redFlagForQuestion(question: string, durationNote: string): boolean {
  return screenWrittenQuestion(`${question} ${durationNote}`).redFlag;
}

/** The three states of the gate for one send attempt. */
export type RedFlagGate = "clear" | "blocked" | "acknowledged";

export function nextGate(hit: boolean, acknowledged: boolean): RedFlagGate {
  if (!hit) return "clear";
  return acknowledged ? "acknowledged" : "blocked";
}
