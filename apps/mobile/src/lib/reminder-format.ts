import type { MessageKey } from "@tarragon/i18n";
import { LAGOS_OFFSET_MS, lagosLocalDate, weekdayOf } from "./lagos-date";
import type { PlannedNotification } from "./reminder-plan";

/**
 * How reminders are described on the Reminders screen. Pure: no Intl and no
 * clock, so it behaves the same on every phone, and always in Lagos time.
 */
export const DAY_KEYS: readonly MessageKey[] = [
  "reminders.day.0",
  "reminders.day.1",
  "reminders.day.2",
  "reminders.day.3",
  "reminders.day.4",
  "reminders.day.5",
  "reminders.day.6",
];

/** Every day, or the chosen days in week order Monday to Sunday. */
export function daysSummary(days: readonly number[] | null): { everyDay: true } | { everyDay: false; keys: MessageKey[] } {
  if (days === null || days.length === 7) return { everyDay: true };
  const order = [1, 2, 3, 4, 5, 6, 0];
  return { everyDay: false, keys: order.filter((d) => days.includes(d)).map((d) => DAY_KEYS[d] as MessageKey) };
}

export interface UpcomingLine {
  kind: "bp" | "dose";
  /** Key for the weekday, then DD/MM. */
  weekdayKey: MessageKey;
  date: string;
  time: string;
}

export function describeUpcoming(n: PlannedNotification): UpcomingLine {
  const local = lagosLocalDate(n.notifyAtMs);
  return {
    kind: n.kind,
    weekdayKey: DAY_KEYS[weekdayOf(local)] as MessageKey,
    date: `${local.slice(8, 10)}/${local.slice(5, 7)}`,
    time: new Date(n.notifyAtMs + LAGOS_OFFSET_MS).toISOString().slice(11, 16),
  };
}
