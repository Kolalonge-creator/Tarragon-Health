import { t } from "@tarragon/i18n";
import { confidenceDots, cycleStatus, type ConfidenceDots, type CycleConfidence, type CyclePrediction, type CycleStatusTone, type PeriodInProgress } from "@tarragon/shared";

/**
 * UI-A: the plain words and small date helpers behind the redesigned cycle screen. Pure, so Jest can check them without a device.
 * Every sentence comes from `@tarragon/i18n` (`cycle.*`); every number comes from the prediction the engine returned.
 */

/** "Period expected in about 3 days." or the calm late wording. Never a percentage, never a promise. */
export function statusSentence(prediction: CyclePrediction, inProgress?: PeriodInProgress | null): string {
  const s = cycleStatus(prediction, inProgress);
  switch (s.kind) {
    case "in_progress":
      if (s.days === 0 || s.days === null) return t("cycle.status.started_today");
      return s.days === 1 ? t("cycle.status.started_one") : t("cycle.status.started_days", undefined, { days: s.days });
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

export function statusTone(prediction: CyclePrediction, inProgress?: PeriodInProgress | null): CycleStatusTone {
  return cycleStatus(prediction, inProgress).tone;
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

// --- the day-log draft: kept by the screen, not by the sheet, so closing the sheet does not lose what was chosen -----------------

export interface DayDraft {
  flow: string | null;
  symptoms: string[];
  moods: string[];
  notes: string;
  bbt: string;
  ovulationTest: string | null;
}

interface DraftSource {
  flow: string | null;
  symptoms: string[];
  moods: string[];
  notes: string | null;
  basal_body_temperature_c: number | null;
  ovulation_test_result: string | null;
}

export function draftFromLog(existing: DraftSource | null): DayDraft {
  return {
    flow: existing?.flow ?? null,
    symptoms: [...(existing?.symptoms ?? [])],
    moods: [...(existing?.moods ?? [])],
    notes: existing?.notes ?? "",
    bbt: existing?.basal_body_temperature_c != null ? String(existing.basal_body_temperature_c) : "",
    ovulationTest: existing?.ovulation_test_result ?? null,
  };
}

/** What the sheet opens with for a date: the unsaved draft if there is one, else the saved log, else empty. */
export function draftFor(drafts: Readonly<Record<string, DayDraft>>, date: string, existing: DraftSource | null): DayDraft {
  return drafts[date] ?? draftFromLog(existing);
}

export function withDraft(drafts: Readonly<Record<string, DayDraft>>, date: string, draft: DayDraft): Record<string, DayDraft> {
  return { ...drafts, [date]: draft };
}

/** Called after a successful save only. A failed save keeps the draft. */
export function withoutDraft(drafts: Readonly<Record<string, DayDraft>>, date: string): Record<string, DayDraft> {
  const next = { ...drafts };
  delete next[date];
  return next;
}

// --- errors that must not hide a save ----------------------------------------------------------------------------------------

/**
 * Runs a write and never throws: a thrown error becomes a calm failure, so the caller can always reset its "busy" flag.
 */
export async function guardedAction(run: () => Promise<{ ok: boolean; error?: string }>): Promise<{ ok: boolean; error?: string }> {
  try {
    return await run();
  } catch {
    return { ok: false, error: "Could not save that just now. Please try again." };
  }
}

/**
 * When a re-read fails: if the screen already has data (a save just succeeded), keep the screen and add a small
 * "saved, but could not refresh" note; only a first load with nothing to show becomes the full error.
 */
export function refreshFailureView(hasData: boolean): "saved_note" | "full_error" {
  return hasData ? "saved_note" : "full_error";
}
