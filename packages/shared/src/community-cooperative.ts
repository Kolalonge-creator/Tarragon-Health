/**
 * Reference model and copy rules for the cooperative framing of cohort challenges (S69c). The database is the source of truth
 * (`supabase/migrations/*_s69c_cooperative_shared_goal.sql`); this file is the same logic written once in plain code so it can be tested
 * without a database and shared by the web and mobile screens.
 *
 * Rules it encodes: the shared goal is drawn from the already-suppressed aggregate only; "weeks active" never goes down; a skipped week and a
 * rest check-in carry no penalty and no message; one person's day is capped; only the calendar day of an event is kept.
 */
export type CooperativeRules = {
  readonly daily_cap_days: number;
  readonly daily_cap_lessons: number;
  readonly daily_cap_minutes: number;
  readonly rest_checkin_minutes: number;
  readonly path_milestones: number;
};

export type EffortUnit = "days" | "lessons" | "minutes";

/** One person's counted contribution for one day: never more than the configured cap, whatever path wrote it. */
export function capDailyContribution(value: number, unit: EffortUnit, rules: CooperativeRules): number {
  const cap = unit === "lessons" ? rules.daily_cap_lessons : unit === "minutes" ? rules.daily_cap_minutes : rules.daily_cap_days;
  return Math.max(0, Math.min(value, cap));
}

/** The rest check-in counts the same as a day of effort: one day or one lesson, or the configured minutes. */
export function restCheckinValue(unit: EffortUnit, rules: CooperativeRules): number {
  return unit === "minutes" ? rules.rest_checkin_minutes : 1;
}

export type PathStep = { readonly index: number; readonly reached: boolean; readonly current: boolean };
export type SharedGoalPath = {
  readonly steps: readonly PathStep[];
  readonly reachedCount: number;
  readonly total: number;
  readonly complete: boolean;
};

/**
 * The shared-goal path. Input is the cohort's published progress percentage (the already-suppressed band, never anyone's own figure) or
 * `null` when the total is pending or hidden. A hidden or pending total draws an empty path with no step reached: it never guesses.
 */
export function sharedGoalPath(progressPct: number | null, milestones: number): SharedGoalPath {
  const total = Math.max(2, Math.floor(milestones));
  const pct = progressPct === null || Number.isNaN(progressPct) ? 0 : Math.max(0, Math.min(100, progressPct));
  const reachedCount = Math.min(total, Math.floor((pct / 100) * total));
  const steps: PathStep[] = [];
  for (let i = 0; i < total; i += 1) steps.push({ index: i + 1, reached: i < reachedCount, current: i === reachedCount && reachedCount < total });
  return { steps, reachedCount, total, complete: reachedCount === total };
}

/** Monday of the week containing a calendar day (YYYY-MM-DD), as the database does with date_trunc('week'). */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Weeks active: how many calendar weeks hold at least one day of effort. It only counts weeks that happened, so it cannot fall (adding a
 * day never lowers it) and a skipped week does not subtract from it. Missing weeks are simply not counted; there is no streak to break.
 */
export function weeksActive(effortDays: readonly string[]): number {
  return new Set(effortDays.map(weekStart)).size;
}

/** Only the calendar day of an event is kept (Africa/Lagos). The time of day is dropped before anything is stored. */
export function toEventDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/** Words and phrases that must never appear in challenge copy: they turn effort into a debt or a failure. */
export const SHAME_PHRASES: readonly string[] = [
  "fell behind", "falling behind", "behind", "lagging", "slacking", "slacker", "lazy", "laziness", "failed", "failure", "you missed", "missed out",
  "streak broken", "broke your streak", "lost your streak", "start over", "back to zero", "reset to zero", "reset your", "disappoint", "let down",
  "letting the group down", "let the group down", "falling short", "not good enough", "you should have", "last place", "worst", "loser", "penalty",
  "penalised", "penalized", "catch up", "too late", "give up", "dragging", "holding the group back", "your fault",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The shame phrases found in a piece of copy (case-insensitive, whole words). */
export function findShameCopy(text: string): string[] {
  const lower = text.toLowerCase();
  return SHAME_PHRASES.filter((p) => new RegExp(`(^|[^a-z])${escapeRegExp(p)}([^a-z]|$)`).test(lower));
}
