/**
 * Who may receive an assistant nudge notification. Pure, so the rule is unit tested without a database. The assistant_enabled guard
 * decides for real patients; an is_test patient is always eligible (the same test rule go_live_open_patient uses), so the whole flow can
 * be exercised before the guard is on. A real person is never reached while the guard is off.
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
