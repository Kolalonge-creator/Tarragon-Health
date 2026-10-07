import { summariseReadings, type VisitReportReading, type VisitReportSummary } from "./summarise";

/**
 * "Your week": the last 7 days of a patient's own readings against the 7
 * days before. Descriptive only. A change is a number difference, never a
 * verdict on whether it is good or bad; that is for the care team.
 */

export type WeeklyReading = VisitReportReading;

export interface WeeklySummary {
  /** Days (Africa/Lagos calendar days) in the last 7 with at least one valid reading. */
  loggedDays: number;
  thisWeek: VisitReportSummary;
  lastWeek: VisitReportSummary;
  /** This week's average minus last week's, only when both weeks have BP readings. */
  bpAverageChange: { systolic: number; diastolic: number } | null;
  /** True when the query hit its row cap, so older rows (last week) may be incomplete. */
  partial: boolean;
}

const DAY_MS = 86_400_000;

function lagosDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export function buildWeeklySummary(
  readings: WeeklyReading[],
  now: Date,
  options: { partial?: boolean } = {},
): WeeklySummary {
  const partial = options.partial === true;
  const t = now.getTime();
  const thisStart = t - 7 * DAY_MS;
  const lastStart = t - 14 * DAY_MS;

  const inRange = (r: WeeklyReading, from: number, to: number): boolean => {
    const at = new Date(r.taken_at).getTime();
    return at > from && at <= to;
  };
  const thisRows = readings.filter((r) => inRange(r, thisStart, t));
  const lastRows = readings.filter((r) => inRange(r, lastStart, thisStart));

  const thisWeek = summariseReadings(thisRows, 7);
  const lastWeek = summariseReadings(lastRows, 7);

  const days = new Set(
    thisRows.filter((r) => r.validation_status === "valid").map((r) => lagosDay(r.taken_at)),
  );

  const bpAverageChange =
    !partial && thisWeek.bp && lastWeek.bp
      ? {
          systolic: thisWeek.bp.averageSystolic - lastWeek.bp.averageSystolic,
          diastolic: thisWeek.bp.averageDiastolic - lastWeek.bp.averageDiastolic,
        }
      : null;

  return { loggedDays: days.size, thisWeek, lastWeek, bpAverageChange, partial };
}
