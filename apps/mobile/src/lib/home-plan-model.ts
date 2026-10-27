import type { HomeCardCode, ReadinessResult, TodayFacts } from "@tarragon/clinical/today";
import type { MessageKey } from "@tarragon/i18n";
import type { Line } from "./home-model";
import { lagosLocalDate, type LocalDate } from "./lagos-date";
import type { SectionId } from "./sections";
import type { StreakState, WeekDayState } from "./streaks";
import type { TodayList } from "./today-model";

/**
 * Pure helpers for the S47b Today plan on the phone: the facts handed to `buildToday`, the words for each card, and the streak and readiness lines.
 * No clock, no network and no storage here. Nothing grades a reading, a streak or a person: a quiet day is "open", never "missed".
 */

export interface PlanSources {
  today: { list: TodayList; bpLoggedToday: boolean; bpHistory: boolean };
  hasDevice: boolean;
  /** The week's active-minutes goal against what was done, or null when the person has no goal or it could not be read. */
  activityWeek: { activeMinutes: number; goalMinutes: number } | null;
  lessonAvailable: boolean;
  streakAvailable: boolean;
  weeklyAvailable: boolean;
  readinessAvailable: boolean;
}

export function buildFacts(src: PlanSources): TodayFacts {
  const { list, bpLoggedToday } = src.today;
  const tasks = [...list.open, ...list.done].filter((i) => i.source === "task");
  const openTasks = list.open.filter((i) => i.source === "task");
  const doses = [...list.open, ...list.done].filter((i) => i.source === "dose");
  const pendingDoses = list.open.filter((i) => i.source === "dose");
  return {
    // Goals and pathways are not read on the phone yet: an empty list means a card whose rule names one stays hidden (fail closed).
    goals: [],
    pathways: [],
    hasDevice: src.hasDevice,
    task: tasks.length > 0 || openTasks.length > 0 ? { openCount: openTasks.length, overdueCount: openTasks.filter((i) => i.status === "overdue").length } : null,
    medicines: doses.length > 0 ? { pendingCount: pendingDoses.length } : null,
    // Only for a person who logs blood pressure (or has a task to): otherwise a glucose-only person would be asked to log a reading every day.
    readings: src.today.bpHistory || tasks.some((i) => i.kind === "log_bp") ? { loggedToday: bpLoggedToday } : null,
    goal: src.activityWeek && src.activityWeek.goalMinutes > 0 ? { metToday: src.activityWeek.activeMinutes >= src.activityWeek.goalMinutes } : null,
    lesson: src.lessonAvailable ? { available: true } : null,
    assistantNudge: { available: true },
    streak: src.streakAvailable ? { available: true } : null,
    weekly: src.weeklyAvailable ? { available: true } : null,
    readiness: src.readinessAvailable ? { available: true } : null,
  };
}

/** Where tapping a card goes. */
export const CARD_TARGET: Record<HomeCardCode, SectionId> = {
  task_due: "care",
  medicines: "medications",
  readings: "vitals",
  goal: "activity",
  lesson: "learn",
  assistant_nudge: "aiCoach",
  streak: "vitals",
  weekly_summary: "vitals",
  readiness: "activity",
};

export function cardTitle(code: HomeCardCode): MessageKey | null {
  switch (code) {
    case "task_due":
      return "today.card.task_due.title";
    case "medicines":
      return "today.card.medicines.title";
    case "readings":
      return "today.card.readings.title";
    case "goal":
      return "today.card.goal.title";
    case "lesson":
      return "today.card.lesson.title";
    case "assistant_nudge":
      return "today.card.assistant_nudge.title";
    default:
      return null; // streak, weekly summary and readiness draw their own content
  }
}

export function cardAction(code: HomeCardCode): MessageKey | null {
  switch (code) {
    case "task_due":
      return "today.card.task_due.action";
    case "medicines":
      return "today.card.medicines.action";
    case "readings":
      return "today.card.readings.action";
    case "goal":
      return "today.card.goal.action";
    case "lesson":
      return "today.card.lesson.action";
    case "assistant_nudge":
      return "today.card.assistant_nudge.action";
    default:
      return null;
  }
}

/** The "done" sentence of a card that can be finished for the day, or null when it has none. */
export function cardDone(code: HomeCardCode): MessageKey | null {
  switch (code) {
    case "medicines":
      return "today.card.medicines.done";
    case "readings":
      return "today.card.readings.done";
    case "goal":
      return "today.card.goal.done";
    default:
      return null;
  }
}

// ── Streak ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_STATE_KEY: Record<WeekDayState, MessageKey> = {
  done: "streak.day.done",
  freeze: "streak.day.freeze",
  excused: "streak.day.excused",
  today: "streak.day.today",
  open: "streak.day.open",
  future: "streak.day.future",
};

export function dayStateKey(state: WeekDayState): MessageKey {
  return DAY_STATE_KEY[state];
}

/** The calm lines under the streak card. Every state has words; none of them blames. */
export function streakLines(s: StreakState): { headline: Line; notes: Line[] } {
  const notes: Line[] = [];
  const headline: Line =
    s.current === 0
      ? { key: "streak.start" }
      : s.current === 1
        ? { key: "streak.current_one" }
        : { key: "streak.current_other", params: { count: s.current } };
  if (s.current > 0 && s.best > s.current) notes.push({ key: "streak.best", params: { count: s.best } });
  if (s.proposedFreezeDate) notes.push({ key: "streak.freeze_used" });
  else if (s.freezesAvailable === 1) notes.push({ key: "streak.freeze_have_one" });
  else if (s.freezesAvailable > 1) notes.push({ key: "streak.freeze_have_other", params: { count: s.freezesAvailable } });
  else if (s.current > 0) notes.push({ key: "streak.freeze_none" });
  notes.push(s.todayDone ? { key: "streak.today_done" } : { key: "streak.today_open" });
  return { headline, notes };
}

/** Lagos days on which at least one reading was logged. A row with an unreadable time is skipped. */
export function doneDatesFrom(takenAt: readonly (string | null | undefined)[]): LocalDate[] {
  const out = new Set<LocalDate>();
  for (const t of takenAt) {
    const ms = t ? Date.parse(t) : Number.NaN;
    if (Number.isFinite(ms)) out.add(lagosLocalDate(ms));
  }
  return [...out];
}

/** Adds a freeze date to the stored list once, keeping the list short. */
export function withFreeze(stored: readonly string[], date: LocalDate, keep = 60): string[] {
  return stored.includes(date) ? [...stored] : [...stored, date].slice(-keep);
}

// ── Readiness ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReadinessView {
  band: MessageKey;
  line: MessageKey;
  reasons: MessageKey[];
}

/** The plain words for a readiness result, or null when there is nothing to say (the card is then not drawn at all). */
export function readinessView(r: ReadinessResult): ReadinessView | null {
  if (r.kind !== "band") return null;
  const reasons = r.moves.map((m) => `readiness.move.${m.signal}.${m.move}` as MessageKey);
  switch (r.band) {
    case "steady":
      return { band: "readiness.band.steady", line: "readiness.line.steady", reasons };
    case "take_it_easier":
      return { band: "readiness.band.take_it_easier", line: "readiness.line.take_it_easier", reasons };
    case "rested":
      return { band: "readiness.band.rested", line: "readiness.line.rested", reasons };
  }
}
