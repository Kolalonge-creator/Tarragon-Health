/** Which single screen to show. Anything unrecognised is the overview, never an empty page. */
export type HealthCheckView = "overview" | "wellbeing" | "tests";
export function healthCheckView(step: string | string[] | undefined): HealthCheckView {
  const value = Array.isArray(step) ? step[0] : step;
  return value === "wellbeing" || value === "tests" ? value : "overview";
}
