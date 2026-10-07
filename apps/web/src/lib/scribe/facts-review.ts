/**
 * The clinician's side of the "facts to confirm" step. Pure: no I/O, no clock.
 *
 * Every fact the model listed must be decided: confirmed (optionally with the text corrected) or rejected. There is no
 * "confirm all": a one-click bulk confirm would turn the step into a skim, which is the failure it exists to prevent.
 * The clinician can also add a fact the model missed; that is how an omission is repaired, and an added fact carries no
 * quote (it is the clinician's own statement). Only confirmed and added facts go to stage two.
 */
import type { FactType, ScribeFact } from "./facts";

export type Decision = "confirmed" | "rejected";
export interface FactsReviewState {
  readonly decisions: Readonly<Record<string, Decision>>;
  readonly edits: Readonly<Record<string, string>>;
  readonly added: readonly ScribeFact[];
}

export const EMPTY_REVIEW: FactsReviewState = { decisions: {}, edits: {}, added: [] };

export function decide(state: FactsReviewState, id: string, decision: Decision | null): FactsReviewState {
  const decisions = { ...state.decisions };
  if (decision === null) delete decisions[id];
  else decisions[id] = decision;
  return { ...state, decisions };
}

export function editText(state: FactsReviewState, id: string, text: string): FactsReviewState {
  return { ...state, edits: { ...state.edits, [id]: text } };
}

export function addFact(state: FactsReviewState, type: FactType, text: string): FactsReviewState {
  const trimmed = text.trim();
  if (trimmed === "") return state;
  return { ...state, added: [...state.added, { id: `c${state.added.length + 1}`, type, text: trimmed, quote: "", speaker: "clinician" }] };
}

export function removeAdded(state: FactsReviewState, id: string): FactsReviewState {
  return { ...state, added: state.added.filter((f) => f.id !== id) };
}

export function undecided(facts: readonly ScribeFact[], state: FactsReviewState): ScribeFact[] {
  return facts.filter((f) => !state.decisions[f.id]);
}

/** The facts stage two may use: confirmed model facts (with any corrected text) plus the clinician's own added facts. */
export function confirmedFacts(facts: readonly ScribeFact[], state: FactsReviewState): ScribeFact[] {
  const kept = facts
    .filter((f) => state.decisions[f.id] === "confirmed")
    .map((f) => ({ ...f, text: (state.edits[f.id] ?? f.text).trim() || f.text }));
  return [...kept, ...state.added];
}

export function canWriteDraft(facts: readonly ScribeFact[], state: FactsReviewState): boolean {
  return undecided(facts, state).length === 0 && confirmedFacts(facts, state).length > 0;
}

/** Negations and safety items first, so they are the first thing read: the order of the research's omission classes. */
const PRIORITY: Record<FactType, number> = {
  negated_symptom: 0,
  allergy: 1,
  red_flag: 2,
  medication_mentioned: 3,
  measurement_or_finding: 4,
  symptom: 5,
  history_item: 6,
  plan_item: 7,
  follow_up_item: 8,
};
export function orderedForReview(facts: readonly ScribeFact[]): ScribeFact[] {
  return [...facts].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.id.localeCompare(b.id, undefined, { numeric: true }));
}
