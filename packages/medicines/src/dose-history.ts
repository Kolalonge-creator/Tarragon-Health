import { computeWeeklyAdherence, type AdherenceConfig, type AdherenceMedicine } from "./adherence";
import { addDays, lagosLocalDate } from "./lagos";

/**
 * "Doses taken" for the patient's own charts (2026-11-06, founder: big numbers and charts where they help), shared by the web
 * dashboard and the phone app. Every figure is the one adherence formula (computeWeeklyAdherence, the same as the printed report
 * and the care team's chart), run over COMPLETED Lagos days only, so a dose still open today never counts as missed. Today has its
 * own card (Today's doses).
 *
 * It reports what the patient marked: "doses you marked taken". It is a record, not a grade: no threshold, no colour band.
 */
export interface DoseDay {
  date: string;
  /** Doses that were due that day. 0 means nothing was scheduled. */
  due: number;
  /** Doses marked taken, on time or late. */
  taken: number;
}

export interface DoseWindow {
  due: number;
  taken: number;
  /** Null when fewer than the configured minimum were due: a percentage would say nothing fair. */
  percent: number | null;
}

export interface DoseHistory {
  last7: DoseWindow;
  last30: DoseWindow;
  /** One entry per completed day, oldest first. */
  days: DoseDay[];
}

function windowOf(medicines: readonly AdherenceMedicine[], nowMs: number, cfg: AdherenceConfig, days: number, windowEnd: string): DoseWindow {
  const r = computeWeeklyAdherence(medicines, nowMs, { ...cfg, windowDays: days }, { windowEnd });
  return { due: r.due, taken: r.taken + r.late, percent: r.percent };
}

export function buildDoseHistory(
  medicines: readonly AdherenceMedicine[],
  nowMs: number,
  cfg: AdherenceConfig,
  chartDays = 28,
): DoseHistory {
  const yesterday = addDays(lagosLocalDate(nowMs), -1);
  const days: DoseDay[] = [];
  for (let i = chartDays - 1; i >= 0; i -= 1) {
    const date = addDays(yesterday, -i);
    const w = windowOf(medicines, nowMs, cfg, 1, date);
    days.push({ date, due: w.due, taken: w.taken });
  }
  return {
    last7: windowOf(medicines, nowMs, cfg, 7, yesterday),
    last30: windowOf(medicines, nowMs, cfg, 30, yesterday),
    days,
  };
}

/** Words for one day, for a chart's hover label and screen-reader text: "Thu 5 Nov: 1 of 2 marked taken" or "...: nothing was due". */
export function doseDayText(day: DoseDay): string {
  const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });
  if (day.due === 0) return `${label}: nothing was due`;
  return `${label}: ${day.taken} of ${day.due} marked taken`;
}
