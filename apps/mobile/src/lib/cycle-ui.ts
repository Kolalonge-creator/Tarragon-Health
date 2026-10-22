import { t } from "@tarragon/i18n";
import { confidenceDots, cycleStatus, type ConfidenceDots, type CycleConfidence, type CyclePrediction, type CycleStatusTone } from "@tarragon/shared";

/**
 * UI-A: the plain words and small date helpers behind the redesigned cycle screen. Pure, so Jest can check them without a device.
 * Every sentence comes from `@tarragon/i18n` (`cycle.*`); every number comes from the prediction the engine returned.
 */

/** "Period expected in about 3 days." or the calm late wording. Never a percentage, never a promise. */
export function statusSentence(prediction: CyclePrediction): string {
  const s = cycleStatus(prediction);
  switch (s.kind) {
    case "no_history":
      return t("cycle.status.no_history");
    case "today":
      return t("cycle.status.today");
    case "any_day":
      return t("cycle.status.any_day");
    case "overdue":
      if (s.days === null) return t("cycle.status.overdue");
      return s.days === 1 ? t("cycle.status.overdue_one") : t("cycle.status.overdue_days", undefined, { days: s.days });
    case "in_days":
      return s.days === 1 ? t("cycle.status.in_one_day") : t("cycle.status.in_days", undefined, { days: s.days ?? 0 });
  }
}

export function statusTone(prediction: CyclePrediction): CycleStatusTone {
  return cycleStatus(prediction).tone;
}

export function confidenceSentence(confidence: CycleConfidence): string {
  return t(`cycle.confidence.${confidence}` as const);
}

export function confidenceDotsLabel(confidence: CycleConfidence): string {
  return t("cycle.confidence.dots_label", undefined, { n: confidenceDots(confidence) });
}

export type { ConfidenceDots };

// --- dates (ISO yyyy-mm-dd, UTC arithmetic: the app already holds Lagos "today" as an ISO string) -------------------------------

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addIsoDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface StripDay {
  iso: string;
  weekday: string;
  day: number;
  isToday: boolean;
}

/** The seven days ending today, oldest first: the days people actually log. */
export function lastSevenDays(today: string): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addIsoDays(today, i - 6);
    const d = parse(iso);
    return {
      iso,
      weekday: d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" }),
      day: d.getUTCDate(),
      isToday: iso === today,
    };
  });
}

export interface GridCell {
  iso: string;
  day: number;
}

/** A month as rows of seven, Monday first, with `null` padding so the first day sits in its own column. */
export function monthGrid(year: number, monthIndex: number): (GridCell | null)[][] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: (GridCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= length; day += 1) {
    cells.push({ iso: new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (GridCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function shiftMonth(year: number, monthIndex: number, delta: number): { year: number; monthIndex: number } {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
}

/** Days after today cannot be picked: a log is about a day that has started. */
export function isPickable(iso: string, today: string): boolean {
  return iso <= today;
}

// --- saving without a signal ------------------------------------------------------------------------------------------------

export type SaveFeedback = "saved" | "queued" | "not_sent_offline" | "failed";

/**
 * What to tell the person after a save. "queued" (the offline message) is only ever returned when something really was held on the
 * phone: today nothing is, so an offline failure says it was NOT sent and keeps the choices on screen. See OQ-727.
 */
export function saveFeedback(input: { ok: boolean; heldOnPhone: boolean; offline: boolean }): SaveFeedback {
  if (input.ok) return "saved";
  if (input.heldOnPhone) return "queued";
  return input.offline ? "not_sent_offline" : "failed";
}

/** How many cycle logs are waiting on the phone. Always 0 until the offline outbox carries a cycle log kind (OQ-727). */
export async function countPendingCycleLogs(): Promise<number> {
  return 0;
}
