import type { HomeBand, HomeCheckAssessment } from "@tarragon/clinical";

/**
 * The seven-day home check card (S07x), as a pure decision. No clock, no network, no copy: the caller supplies the assessment
 * (`assessHomeCheck` from @tarragon/clinical, which owns every number) and what is stored on the phone, and gets back which state to show.
 *
 * Rules:
 * - Closed guard (or unknown, with nothing remembered): the card is hidden. It never shows a promise the server would refuse (INV-14).
 * - Sending is the patient's tap. Until the server confirms, nothing says "with your care team" (S06-2: no clinical change is claimed offline).
 * - A short protocol (fewer than the minimum readings or days) never shows an average; it shows what is missing.
 */
export interface StoredHomeCheck {
  /** Lagos date the patient started, YYYY-MM-DD. */
  startDate: string;
  /** When the patient asked to send; kept so a failed or offline send is retried without asking again. */
  sendRequestedAt?: string;
  /** When the server confirmed. */
  submittedAt?: string;
  result?: SentResult;
}

export interface SentResult {
  readings: number;
  days: number;
  systolic: number;
  diastolic: number;
  band: HomeBand;
}

export type HomeCheckView =
  | { kind: "hidden" }
  | { kind: "start" }
  | { kind: "running"; assessment: HomeCheckAssessment }
  | { kind: "ready"; assessment: HomeCheckAssessment; queued: boolean }
  | { kind: "ended_short"; assessment: HomeCheckAssessment }
  | { kind: "sent"; result: SentResult };

export function buildHomeCheckView(input: {
  /** Whether the server's go-live guard is open for this person: true, false, or null when it has never been learned. */
  guardOpen: boolean | null;
  stored: StoredHomeCheck | null;
  /** Required when `stored` is set. */
  assessment: HomeCheckAssessment | null;
}): HomeCheckView {
  const { guardOpen, stored, assessment } = input;
  if (guardOpen !== true) return { kind: "hidden" };
  if (stored === null) return { kind: "start" };
  if (stored.submittedAt !== undefined && stored.result !== undefined) return { kind: "sent", result: stored.result };
  if (assessment === null) return { kind: "start" };
  if (assessment.complete) return { kind: "ready", assessment, queued: stored.sendRequestedAt !== undefined };
  if (assessment.windowOver) return { kind: "ended_short", assessment };
  return { kind: "running", assessment };
}

/** What to say about today's sessions. */
export function todayLine(assessment: HomeCheckAssessment): "morning" | "evening" | "both" | "done" {
  const [morning, evening] = [
    assessment.today.find((s) => s.part === "morning"),
    assessment.today.find((s) => s.part === "evening"),
  ];
  if (morning?.done && evening?.done) return "done";
  if (morning?.done) return "evening";
  if (evening?.done) return "morning";
  return "both";
}

const BANDS: readonly string[] = ["above_home_level", "borderline", "within_home_target"];

/** The server's answer to complete_home_bp_check, checked by hand: anything that does not match is treated as no answer. */
export type SubmitOutcome =
  | { kind: "recorded"; result: SentResult }
  | { kind: "not_enough" }
  | { kind: "closed" }
  | { kind: "offline" };

export function parseCompleteResult(data: unknown): SubmitOutcome | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.complete === false) return { kind: "not_enough" };
  if (d.complete !== true) return null;
  const { readings, days, systolic, diastolic, band } = d;
  if (
    typeof readings !== "number" ||
    typeof days !== "number" ||
    typeof systolic !== "number" ||
    typeof diastolic !== "number" ||
    typeof band !== "string" ||
    !BANDS.includes(band)
  ) {
    return null;
  }
  return { kind: "recorded", result: { readings, days, systolic, diastolic, band: band as HomeBand } };
}

/** Map a failed call to an outcome. 55000 is "not open yet / not signed": the card goes quiet. Anything else is treated as offline and retried later. */
export function outcomeForError(error: { code?: string } | null | undefined): SubmitOutcome {
  return error?.code === "55000" ? { kind: "closed" } : { kind: "offline" };
}
