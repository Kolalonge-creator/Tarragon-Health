/**
 * "Your care journey" on Home (patient dashboard 2.0, spec 4.4; founder decision PD-03).
 *
 * Six stages, each read from a real record, never assumed: health assessment, clinical review, care plan, tests, results and
 * doctor review, ongoing monitoring. The stages can be done in any order, so this is a list of where each one stands, not a
 * stepper with a "current step". Every patient sees it; on Free the three stages that need a doctor (clinical review, care plan,
 * results review) say they are part of Membership instead of pretending to be "not started".
 *
 * A fact that could not be read is `null` and its stage says "We could not check this just now": an unknown must never read as
 * "not started" or "done".
 */

export type JourneyStageId = "assessment" | "review" | "plan" | "tests" | "results" | "monitoring";

/**
 * done: finished or in place. on_you: something for the patient to do. care_team: waiting on the care team. in_progress: under
 * way, nothing to do right now. not_started: nothing yet. membership: part of Membership (Free only). unknown: the read failed.
 */
export type JourneyState = "done" | "on_you" | "care_team" | "in_progress" | "not_started" | "membership" | "unknown";

export interface JourneyStage {
  id: JourneyStageId;
  title: string;
  state: JourneyState;
  /** One short line saying where this stage stands, in plain words. */
  detail: string;
  href: string;
}

export interface JourneyFacts {
  /** Null when the Membership read failed: the doctor stages then say "not available", never "part of Membership". */
  isMember: boolean | null;
  /** A completed risk assessment, or a submitted baseline assessment. */
  assessmentDone: boolean | null;
  /** The latest preventive baseline's state, or "none". */
  baselineState: "none" | "submitted" | "authorised" | "adjusted" | null;
  /** An active care plan, or a doctor-authorised preventive plan. */
  carePlanActive: boolean | null;
  /** Lab orders not yet resulted or cancelled. */
  openTestCount: number | null;
  /** Lab orders with a result. */
  resultedTestCount: number | null;
  /** Results and documents waiting for a doctor. */
  resultsAwaitingDoctor: number | null;
  /** Results and documents a doctor has reviewed. */
  resultsReviewed: number | null;
  /** Any reading in the last 14 days. */
  recentReading: boolean | null;
  /** Any reading ever. */
  anyReading: boolean | null;
}

const UNKNOWN_DETAIL = "We could not check this just now.";
const MEMBERSHIP_DETAIL = "Part of Membership: a doctor does this with you.";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function assessment(f: JourneyFacts): JourneyStage {
  const base = { id: "assessment" as const, title: "Health assessment", href: "/patient/prevention" };
  if (f.assessmentDone === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  return f.assessmentDone
    ? { ...base, state: "done", detail: "Done. You can update it whenever something changes." }
    : { ...base, state: "on_you", detail: "Tell us about your health so we can suggest the right checks." };
}

function review(f: JourneyFacts): JourneyStage {
  const base = { id: "review" as const, title: "Clinical review", href: "/patient/prevention" };
  if (f.isMember === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (!f.isMember) return { ...base, state: "membership", detail: MEMBERSHIP_DETAIL, href: "/patient/membership" };
  switch (f.baselineState) {
    case null:
      return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
    case "authorised":
    case "adjusted":
      return { ...base, state: "done", detail: "A doctor has reviewed your assessment." };
    case "submitted":
      return { ...base, state: "care_team", detail: "Waiting for a doctor to review your assessment." };
    case "none":
      return { ...base, state: "on_you", detail: "Send your assessment to a doctor for review." };
  }
}

function plan(f: JourneyFacts): JourneyStage {
  const base = { id: "plan" as const, title: "Your care plan", href: "/patient/care" };
  if (f.isMember === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (!f.isMember) return { ...base, state: "membership", detail: MEMBERSHIP_DETAIL, href: "/patient/membership" };
  if (f.carePlanActive === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  return f.carePlanActive
    ? { ...base, state: "done", detail: "Your plan is in place." }
    : { ...base, state: "not_started", detail: "Your plan appears here after a doctor's review." };
}

function tests(f: JourneyFacts): JourneyStage {
  const base = { id: "tests" as const, title: "Tests", href: "/patient/labs" };
  if (f.openTestCount === null || f.resultedTestCount === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (f.openTestCount > 0) return { ...base, state: "in_progress", detail: `${plural(f.openTestCount, "test", "tests")} in progress.` };
  if (f.resultedTestCount > 0) return { ...base, state: "done", detail: "No tests waiting." };
  return { ...base, state: "not_started", detail: "No tests requested yet." };
}

function results(f: JourneyFacts): JourneyStage {
  const base = { id: "results" as const, title: "Results and doctor review", href: "/patient/health-records" };
  if (f.isMember === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (!f.isMember) return { ...base, state: "membership", detail: MEMBERSHIP_DETAIL, href: "/patient/membership" };
  if (f.resultsAwaitingDoctor === null || f.resultsReviewed === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (f.resultsAwaitingDoctor > 0) {
    return { ...base, state: "care_team", detail: `${plural(f.resultsAwaitingDoctor, "result", "results")} waiting for a doctor.` };
  }
  // "Done" only says nothing is waiting: a past review says nothing about a newer upload, so it never claims "all reviewed".
  if (f.resultsReviewed > 0) return { ...base, state: "done", detail: "No results waiting for a doctor." };
  return { ...base, state: "not_started", detail: "No results yet. Upload one any time." };
}

function monitoring(f: JourneyFacts): JourneyStage {
  const base = { id: "monitoring" as const, title: "Ongoing monitoring", href: "/patient/vitals" };
  if (f.recentReading === null || f.anyReading === null) return { ...base, state: "unknown", detail: UNKNOWN_DETAIL };
  if (f.recentReading) return { ...base, state: "in_progress", detail: "You have logged a reading in the last two weeks." };
  if (f.anyReading) return { ...base, state: "on_you", detail: "No reading in the last two weeks." };
  return { ...base, state: "not_started", detail: "Log your first reading." };
}

export function buildCareJourney(f: JourneyFacts): JourneyStage[] {
  return [assessment(f), review(f), plan(f), tests(f), results(f), monitoring(f)];
}

/** The chip wording for each state. Always words, never colour alone. */
export const JOURNEY_STATE_LABEL: Record<JourneyState, string> = {
  done: "Done",
  on_you: "To do",
  care_team: "With your care team",
  in_progress: "Under way",
  not_started: "Not yet",
  membership: "Membership",
  unknown: "Not available",
};
