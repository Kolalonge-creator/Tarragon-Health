/**
 * Clinical Decision Support (spec §38) — shared types.
 *
 * A CdsRecommendation is the point-of-care unit the whole feature revolves
 * around: "here is something relevant, here is why, here is where it comes
 * from". Nothing in this module touches the database — see engine.ts for how
 * one is produced and prioritise.ts for how a list of them is trimmed down to
 * something a clinician can actually read in a 10-minute consultation.
 */

/** Mirrors the platform's own five business categories closely enough to file
 * a recommendation under something the clinician already recognises, rather
 * than inventing a taxonomy CDS alone understands. */
export type CdsCategory =
  | "chronic_disease_control"
  | "medication_safety"
  | "monitoring"
  | "referral";

export const CDS_CATEGORY_LABEL: Record<CdsCategory, string> = {
  chronic_disease_control: "Chronic disease control",
  medication_safety: "Medication safety",
  monitoring: "Monitoring",
  referral: "Referral",
};

/**
 * §38.11's alert-fatigue rule ("avoid producing 25 alerts during a 10-minute
 * consultation") needs something to rank on before it can cap anything —
 * this is that ranking. 'high' is reserved for what genuinely changes today's
 * management (a contraindicated interaction, resistant hypertension); 'low'
 * is context that's useful but not actionable this visit.
 */
export type CdsPriority = "high" | "medium" | "low";

export interface CdsRecommendation {
  /**
   * Stable identity of WHAT this is, independent of the facts behind it right
   * now — e.g. 'bp_uncontrolled' or 'medication_safety:interaction:<ids>'.
   * A clinician's decision is filed against this key (see
   * cds_recommendation_decisions.recommendation_key) so it can be found again
   * across visits even after the underlying numbers move.
   */
  key: string;
  /**
   * Deterministic fingerprint of the material clinical facts driving this
   * recommendation right now (the exact medication ids, the due date, the BP
   * average). A clinician's decision only suppresses the recommendation while
   * this still matches — see prioritise.ts. Two recommendations that differ
   * only in wording must never differ in fingerprint, and two that differ in
   * a fact that would change the clinician's decision must never share one.
   */
  fingerprint: string;
  category: CdsCategory;
  priority: CdsPriority;
  /** Short headline, e.g. "BP remains uncontrolled." (§38.3 style). */
  title: string;
  /** §38.13 "Why am I seeing this?" — always shown next to the recommendation. */
  triggerText: string;
  /** §38.5 — the guideline/protocol this recommendation is drawn from, always visible. */
  sourceLabel: string;
  /** medications.id values this recommendation is about, for UI cross-highlighting. Optional — not every recommendation is medication-scoped. */
  medicationIds?: string[];
}
