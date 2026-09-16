/**
 * The six named next-steps Result Lifecycle §58.11 lists — action_type is
 * the governed category, follow_up_action stays the free-text detail
 * alongside it (e.g. "Repeat FBC in 3 months", "Start metformin 500mg").
 *
 * Split out of screening-result-actions.ts: that file is "use server", which
 * requires every export to be an async function — a plain constant export
 * there broke the whole server-actions bundle for this route.
 */
export const RESULT_ACTION_TYPES = [
  "repeat_test",
  "medication_change",
  "appointment",
  "specialist_referral",
  "monitoring",
  "no_action",
] as const;
export type ResultActionType = (typeof RESULT_ACTION_TYPES)[number];
