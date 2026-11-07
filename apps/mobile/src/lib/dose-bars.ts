import type { DoseDay } from "@tarragon/medicines";

export interface DoseBar {
  date: string;
  /** Full bar height: the doses due that day, scaled to the busiest day. A day with nothing due is a short tick. */
  total: number;
  /** The filled part: doses marked taken. */
  taken: number;
  /** Nothing was due that day (drawn as the short tick, nothing filled). */
  empty: boolean;
}

/** Bar geometry for the doses-taken chart, the same proportions as the web chart (components/charts/dose-bars.tsx). */
export function doseBars(days: readonly DoseDay[], height: number): DoseBar[] {
  const maxDue = Math.max(1, ...days.map((d) => d.due));
  return days.map((day) => {
    if (day.due === 0) return { date: day.date, total: 3, taken: 0, empty: true };
    const total = Math.max(6, (day.due / maxDue) * height);
    return { date: day.date, total, taken: (Math.min(day.taken, day.due) / day.due) * total, empty: false };
  });
}

/** One sentence for a screen reader: the whole chart in words, so nothing depends on colour. */
export function doseChartSummary(window: { due: number; taken: number }, days: number): string {
  if (window.due === 0) return `Nothing was due in the last ${days} days.`;
  return `In the last ${days} days you marked ${window.taken} of ${window.due} doses taken.`;
}
