import { addDays, daysBetween, isValidLocalDate, weekStart, type LocalDate } from "./lagos-date";
import type { StreakRulesConfig } from "./s07-config";

/**
 * The logging streak, as a pure function of Lagos local dates. No clock, no
 * storage and no copy: the screen supplies the dates and words.
 *
 * Rules (PROPOSED, versioned in streaks.rules; see docs/research/S07.md section 6):
 * - A day counts when at least one reading was logged on it. The value of the
 *   reading never matters: a high reading counts exactly like a normal one, so
 *   the streak can never reward "better" numbers or discourage logging a bad one.
 * - Today stays open until the Lagos day ends. An unlogged today never breaks a
 *   streak, so the streak never reads as zero in the middle of a day.
 * - A freeze is earned every `freezeEarnEveryDays` logged days of a run and held
 *   up to `freezeCap`. It protects one missed day, is shown as a freeze and never
 *   counts as a reading. Only yesterday can be frozen, so a freeze cannot rewrite
 *   history. The function proposes the freeze (`proposedFreezeDate`) and treats
 *   it as applied; the caller persists it as a `streak_events` row.
 * - An excused day (for example a documented outage) neither breaks nor extends.
 * - There is no shame state: a day with nothing on it is "open", never "missed".
 *
 * Caller contract for freezes: `proposedFreezeDate` must be written as a
 * `streak_events` row before the Lagos day rolls over. If it is not recorded,
 * the next computation sees that day as an older missed day (only yesterday can
 * be frozen) and the run resets. A malformed date in the input is dropped and
 * counted in `ignoredInvalidDates`, never thrown, so one bad local row cannot
 * crash the Today screen.
 */
export type StreakEventKind = "freeze" | "excused";

export interface StreakEvent {
  localDate: LocalDate;
  kind: StreakEventKind;
}

export type WeekDayState = "done" | "freeze" | "excused" | "today" | "open" | "future";

export interface WeekDay {
  localDate: LocalDate;
  state: WeekDayState;
}

export interface StreakState {
  /** Consecutive logged days ending today (if logged) or yesterday. */
  current: number;
  best: number;
  freezesAvailable: number;
  /** Dates or events dropped because they were not a valid YYYY-MM-DD date. Never throws on bad rows. */
  ignoredInvalidDates: number;
  todayDone: boolean;
  lastDoneDate: LocalDate | null;
  /** Yesterday, when a freeze should be recorded to protect the run; otherwise null. */
  proposedFreezeDate: LocalDate | null;
  /** Monday to Sunday of the current Lagos week. */
  week: WeekDay[];
  daysDoneThisWeek: number;
}

export interface StreakInput {
  /** Local dates with at least one logged reading. Duplicates are fine. */
  doneDates: readonly LocalDate[];
  events: readonly StreakEvent[];
  todayLocal: LocalDate;
  rules: StreakRulesConfig;
}

export function computeStreak(input: StreakInput): StreakState {
  const { todayLocal, rules } = input;
  const validDone = input.doneDates.filter(isValidLocalDate);
  const validEvents = input.events.filter((e) => isValidLocalDate(e.localDate));
  const ignoredInvalidDates = input.doneDates.length - validDone.length + (input.events.length - validEvents.length);
  const done = new Set(validDone);
  const frozen = new Set<LocalDate>();
  const excused = new Set<LocalDate>();
  for (const e of validEvents) {
    if (done.has(e.localDate)) continue; // a logged day is a logged day
    (e.kind === "freeze" ? frozen : excused).add(e.localDate);
  }

  const pastDates = [...done, ...frozen, ...excused].filter((d) => d <= todayLocal).sort();
  const lastDoneDate = [...done].filter((d) => d <= todayLocal).sort().pop() ?? null;
  const yesterday = addDays(todayLocal, -1);

  let run = 0;
  let best = 0;
  let available = 0;
  let proposedFreezeDate: LocalDate | null = null;

  const earn = () => {
    if (run > 0 && run % rules.freezeEarnEveryDays === 0) available = Math.min(rules.freezeCap, available + 1);
  };

  if (pastDates.length > 0) {
    const first = pastDates[0] as LocalDate;
    const span = daysBetween(first, yesterday);
    for (let i = 0; i <= span; i++) {
      const d = addDays(first, i);
      if (done.has(d)) {
        run += 1;
        best = Math.max(best, run);
        earn();
      } else if (frozen.has(d)) {
        if (available > 0) available -= 1; // a freeze with no credit behind it is not honoured
        else run = 0;
      } else if (excused.has(d)) {
        // neither breaks nor extends
      } else if (d === yesterday && run > 0 && available > 0) {
        available -= 1;
        proposedFreezeDate = d;
      } else {
        run = 0;
      }
    }
  }

  const todayDone = done.has(todayLocal);
  if (todayDone) {
    run += 1;
    best = Math.max(best, run);
    earn();
  }

  const monday = weekStart(todayLocal);
  const week: WeekDay[] = [];
  let daysDoneThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    let state: WeekDayState;
    if (d > todayLocal) state = "future";
    else if (done.has(d)) {
      state = "done";
      daysDoneThisWeek += 1;
    } else if (frozen.has(d) || d === proposedFreezeDate) state = "freeze";
    else if (excused.has(d)) state = "excused";
    else if (d === todayLocal) state = "today";
    else state = "open";
    week.push({ localDate: d, state });
  }

  return { current: run, best, freezesAvailable: available, ignoredInvalidDates, todayDone, lastDoneDate, proposedFreezeDate, week, daysDoneThisWeek };
}
