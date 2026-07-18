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
  created_at: string;
}
