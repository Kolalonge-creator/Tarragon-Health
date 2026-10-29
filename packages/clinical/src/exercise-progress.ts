/**
 * Exercise progress, computed from logged sessions and nothing else (P4, patient design audit 2026-10-29).
 *
 * No target is invented here: the programme catalogue carries a week-by-week plan but no sessions-per-week or minutes figure, so progress is
 * reported as what the person did (sessions, minutes, weeks in a row) and where they are in the plan's own length. Dates are Lagos calendar
 * dates as YYYY-MM-DD strings; all arithmetic is on whole days so a time zone can never shift a session into the wrong day.
 */

export interface SessionLike {
  performed_on: string;
  duration_minutes: number;
  enrollment_id: string | null;
}

export interface DayBar {
  date: string;
  minutes: number;
  sessions: number;
}

const MS_PER_DAY = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The last `days` calendar days ending today, oldest first, with the minutes and sessions logged on each. */
export function dailyBars(
  sessions: readonly SessionLike[],
  today: string,
  days = 7,
): DayBar[] {
  const end = dayNumber(today);
  const bars: DayBar[] = [];
  for (let i = days - 1; i >= 0; i--)
    bars.push({ date: fromDayNumber(end - i), minutes: 0, sessions: 0 });
  const byDate = new Map(bars.map((b) => [b.date, b]));
  for (const s of sessions) {
    const bar = byDate.get(s.performed_on);
    if (bar) {
      bar.minutes += s.duration_minutes;
      bar.sessions += 1;
    }
  }
  return bars;
}

export function weekTotals(bars: readonly DayBar[]): {
  sessions: number;
  minutes: number;
  activeDays: number;
} {
  return {
    sessions: bars.reduce((n, b) => n + b.sessions, 0),
    minutes: bars.reduce((n, b) => n + b.minutes, 0),
    activeDays: bars.filter((b) => b.sessions > 0).length,
  };
}

/**
 * Consecutive 7-day blocks (counting back from today) that hold at least one session. A current block with nothing yet does not break the run:
 * someone who walked every week until now and has not yet gone this week still shows their run, until the block is over.
 */
export function weeksInARow(
  sessions: readonly SessionLike[],
  today: string,
): number {
  const end = dayNumber(today);
  const blocks = new Set<number>();
  for (const s of sessions) {
    const age = end - dayNumber(s.performed_on);
    if (age >= 0) blocks.add(Math.floor(age / 7));
  }
  const start = blocks.has(0) ? 0 : 1;
  let run = 0;
  while (blocks.has(start + run)) run++;
  return run;
}

export interface ProgrammeProgress {
  /** 1-based week the person is in, never past the plan's length. */
  currentWeek: number;
  totalWeeks: number;
  /** True once the plan's full length has elapsed since the start. */
  planLengthElapsed: boolean;
  sessionsLogged: number;
  minutesLogged: number;
}

/** Progress through one enrolment: where the person is in the plan's own length, and what they logged against it. */
export function programmeProgress(
  startedOn: string,
  totalWeeks: number,
  sessions: readonly SessionLike[],
  enrollmentId: string,
  today: string,
): ProgrammeProgress {
  const weeks = Math.max(1, totalWeeks);
  const days = Math.max(0, dayNumber(today) - dayNumber(startedOn));
  const mine = sessions.filter((s) => s.enrollment_id === enrollmentId);
  return {
    currentWeek: Math.min(weeks, Math.floor(days / 7) + 1),
    totalWeeks: weeks,
    planLengthElapsed: days >= weeks * 7,
    sessionsLogged: mine.length,
    minutesLogged: mine.reduce((n, s) => n + s.duration_minutes, 0),
  };
}
