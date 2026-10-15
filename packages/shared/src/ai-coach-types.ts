/**
 * AI Health Coach wire types — shared between apps/web's chat UI/server
 * action today and any future caller (mobile) that talks
 * to the same coach turn contract.
 */

/** Triage tier a coach turn resolves to (FEATURE_SPEC §5.2 four-level ladder,
 * minus 'routine' vs the DB's `urgent_escalation` — the coach only ever
 * needs to distinguish "fine", "flag for review", or "emergency now"). */
export const COACH_TIERS = ["routine", "clinician_review", "emergency"] as const;
export type CoachTier = (typeof COACH_TIERS)[number];

/** §78.2 in-chat suggestion -- a pointer to one of the platform's other
 * patient-facing tools (medication education, care-plan explanation,
 * appointment prep, service navigation), offered as a link in the coach's
 * reply. The model only ever CLASSIFIES which tool is relevant, the same
 * discipline as `tier` -- it never executes the tool itself, and the
 * chosen kind maps to a fixed, deterministic navigation target in the UI
 * (ai-coach-chat.tsx), never a model-supplied link or record id. */
export const COACH_SUGGESTED_ACTIONS = [
  "none",
  "medication_education",
  "care_plan_explanation",
  "appointment_prep",
  "service_navigation",
  // S51 (7.6): the patient describes new symptoms -> the symptom checker. Opens the symptom screen; never answered by the model.
  "symptom_check",
] as const;
export type CoachSuggestedAction = (typeof COACH_SUGGESTED_ACTIONS)[number];

/** S51 (7.2, 7.9): one source a reply used, shown to the patient. Never a model-supplied link: built from the rows the code read. */
export const COACH_SOURCE_KINDS = ["reviewed_content", "record", "explanation", "protocol_limits"] as const;
export type CoachSourceKind = (typeof COACH_SOURCE_KINDS)[number];
export interface CoachSource {
  kind: CoachSourceKind;
  /** Patient-facing label, e.g. the content title or "Your Tarragon record". */
  title: string;
  /** Reviewed content only: the clinician who owns it, its version and when it is next due for review. */
  owner?: string;
  version?: number;
  reviewDue?: string;
}

/** The one-line, patient-facing description of a source. Reviewed content names its owner and review date; the record is just its title. */
export function describeCoachSource(source: CoachSource): string {
  if (source.kind !== "reviewed_content") return source.title;
  const owner = source.owner ? `, reviewed by ${source.owner}` : "";
  const due = source.reviewDue ? `, next review ${source.reviewDue}` : "";
  return `${source.title}${owner}${due}`;
}

export interface CoachChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tier?: CoachTier;
  /** Absent or "none" for most turns -- see COACH_SUGGESTED_ACTIONS. */
  suggestedAction?: CoachSuggestedAction;
  /** Which model actually answered this turn -- absent for a user message,
   * absent for an assistant reply the deterministic keyword guardrail
   * produced without ever calling Claude (an honest "no model was used"
   * signal, not a missing field). §78.18 auditability. */
  model?: string;
  /** Titles of any clinician-reviewed reference content this reply drew on
   * (find-relevant-content.ts) -- empty/absent when none was retrieved.
   * §78.18 auditability "knowledge source" coverage. */
  knowledgeSourceUsed?: string[];
  /** S51: the structured sources behind this reply (reviewed content with owner, version and review date; the patient's own record). */
  sources?: CoachSource[];
  created_at: string;
}
