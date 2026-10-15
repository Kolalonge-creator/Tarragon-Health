/**
 * Who may receive an assistant nudge notification. Pure, so the rule is unit tested without a database. The assistant_enabled guard
 * decides for real patients; an is_test patient is NEVER nudged. The rule that actually runs is public.assistant_nudge_candidates() in the
 * database; this mirrors it for the unit tests. A real person is never reached while the guard is off.
 */
export function eligibleForAssistantNudge(p: {
  guardOpen: boolean;
  role: string | null;
  isActive: boolean | null;
  isTest: boolean | null;
}): boolean {
  // A test account is never nudged (it would count as a real engagement signal); a real patient only while the guard is on.
  if (p.role !== "patient" || p.isActive === false || p.isTest === true) return false;
  return p.guardOpen;
}
