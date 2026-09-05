/**
 * The screening stage of the yearly health-check list ("4. Screenings").
 *
 * Pulled out of the page as a pure function because the fail-safe direction
 * matters more than the markup does. `screeningsDue` is an exact count over
 * screening_schedules, and a patient who has never completed the risk
 * assessment has no schedule rows at all — so "0 due" and "up to date" are
 * genuinely different facts, and so is "the count did not come back". The
 * page used to tick a green "Up to date" for all three.
 *
 * Only `done` may claim the patient is up to date. Everything else is either
 * a real to-do or a neutral "we can't say yet".
 */
export type HealthCheckStageState =
  /** A screening calendar exists and nothing on it is outstanding. */
  | { kind: "done"; label: string }
  /** A screening calendar exists and something on it is outstanding. */
  | { kind: "todo"; label: string }
  /** No calendar to count against, or the count did not come back. */
  | { kind: "neutral"; label: string };

export function screeningStageState({
  hasRiskAssessment,
  screeningsDue,
}: {
  hasRiskAssessment: boolean;
  screeningsDue: number | null | undefined;
}): HealthCheckStageState {
  if (screeningsDue === null || screeningsDue === undefined) {
    return {
      kind: "neutral",
      label: "We could not check your screenings just now. Please refresh and try again.",
    };
  }

  if (!hasRiskAssessment) {
    return {
      kind: "neutral",
      label: "Not scheduled yet. Finish your health profile and we'll build your screening plan.",
    };
  }

  if (screeningsDue === 0) {
    return { kind: "done", label: "Up to date" };
  }

  return {
    kind: "todo",
    label: `${screeningsDue} screening${screeningsDue === 1 ? "" : "s"} due, book now`,
  };
}
