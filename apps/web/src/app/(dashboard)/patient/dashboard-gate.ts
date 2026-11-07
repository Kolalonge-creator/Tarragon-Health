/**
 * Where getPatientDashboardContext() sends the caller before a /patient page renders, or null to let it render. Pure, so the
 * routing decision has its own test (dashboard-gate.test.ts).
 *
 * `area` says what kind of page is asking:
 *   - "patient" (the default): a page about the caller's own health. A support-only account (receives_care false) has no record
 *     here, so it is sent to its home, /patient/supporting.
 *   - "supporter": a page in the supporter's own area (/patient/supporting and below). That IS the support-only account's home, so
 *     sending it to /patient/supporting from there redirected the page to itself until the browser gave up (found by the slice H
 *     journeys, 2026-11-07). The proxy still decides which paths a support-only account may reach at all, and what a supporter may
 *     see about another person is still decided by the database (for example circle_help_alert_view's Care Circle membership check),
 *     never by this.
 * Onboarding is required either way.
 */
export type DashboardArea = "patient" | "supporter";

export function dashboardGateRedirect(input: {
  acting: boolean;
  onboardingCompleted: boolean;
  receivesCare: boolean | null;
  area: DashboardArea;
}): "/onboarding" | "/patient/supporting" | null {
  if (input.acting) return null;
  if (!input.onboardingCompleted) return "/onboarding";
  if (input.receivesCare === false && input.area === "patient") return "/patient/supporting";
  return null;
}
