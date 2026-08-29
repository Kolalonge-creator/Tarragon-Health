/**
 * AI Health Coach wire types — shared between apps/web's chat UI/server
 * action today and any future caller (mobile, WhatsApp webhook) that talks
 * to the same coach turn contract.
 */

/** Triage tier a coach turn resolves to (FEATURE_SPEC §5.2 four-level ladder,
 * minus 'routine' vs the DB's `urgent_escalation` — the coach only ever
 * needs to distinguish "fine", "flag for review", or "emergency now"). */
export const COACH_TIERS = ["routine", "clinician_review", "emergency"] as const;
export type CoachTier = (typeof COACH_TIERS)[number];

export interface CoachChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tier?: CoachTier;
  /** Which model actually answered this turn -- absent for a user message,
   * absent for an assistant reply the deterministic keyword guardrail
   * produced without ever calling Claude (an honest "no model was used"
   * signal, not a missing field). §78.18 auditability. */
  model?: string;
  /** Titles of any clinician-reviewed reference content this reply drew on
   * (find-relevant-content.ts) -- empty/absent when none was retrieved.
   * §78.18 auditability "knowledge source" coverage. */
  knowledgeSourceUsed?: string[];
  created_at: string;
}
