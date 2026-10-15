import { computeWeeklyAdherence, type AdherenceConfig, type AdherenceMedicine } from "./adherence";
import { addDays, lagosLocalDate, type LocalDate } from "./lagos";

/**
 * The patient's own adherence report (S08x, decision C6): one row per week, newest first, each over 7
 * COMPLETED Lagos days (so today is never in it), computed with the same function the app and the care
 * team's chart use. It reports what the patient marked: "doses you marked taken". It is a self-report, not
 * a clinical measure, so there is no threshold, no grade and no "below the line" flag in this shape on purpose.
 */
export interface AdherenceReportWeek {
  /** First and last Lagos day of the week, inclusive. */
  weekStart: LocalDate;
  weekEnd: LocalDate;
  /** Doses that were due in the week (as-needed medicines are never counted). */
  due: number;
  /** Doses the patient marked taken, on time or late. */
  markedTaken: number;
  /** Of those, marked taken late. */
  late: number;
  /** Doses the patient chose to skip. They count as not taken and are shown apart from missed. */
  skipped: number;
  /** Doses with no record. */
  noRecord: number;
  /** Doses marked "could not get it". */
  couldNotGet: number;
  /** Null when fewer than `minDoses` doses were due: a percentage would say nothing fair. */
  percent: number | null;
}

export function buildAdherenceReport(
  medicines: readonly AdherenceMedicine[],
  nowMs: number,
  cfg: AdherenceConfig,
  weeks: number,
): AdherenceReportWeek[] {
  const lastDay = addDays(lagosLocalDate(nowMs), -1);
  const out: AdherenceReportWeek[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const windowEnd = addDays(lastDay, -7 * w);
    const r = computeWeeklyAdherence(medicines, nowMs, { ...cfg, windowDays: 7 }, { windowEnd });
    out.push({
      weekStart: r.windowStart,
      weekEnd: r.windowEnd,
      due: r.due,
      markedTaken: r.taken + r.late,
      late: r.late,
      skipped: r.skipped,
      noRecord: r.missed,
      couldNotGet: r.unavailable,
      percent: r.percent,
    });
  }
  return out;
}
