/**
 * Patterns in a patient's OWN check-ins (S56b, function 3). Pure code: no network, no model, no storage, no score.
 *
 * It reads the days a patient already sees beside each other (mood, sleep, blood pressure, tags, day of week) and, only when there is enough of
 * their own data, counts how often their mood was below their own usual on one kind of day against all the others. It reports the counts, never
 * a cause: the sentence templates (packages/i18n `insights.tpl.*`) are checked by a test for causal wording. Nothing here is stored, sent, scored
 * or shown to anyone but the patient, and no clinical threshold is used: every comparison is against the patient's own middle (median) values.
 *
 * The thresholds (how many days, how big a difference) are PROPOSED config `wellbeing.mood_insights`.
 */
import { getProposedConfig } from "../proposed-config";
import type { MoodTrendDay } from "../mental-health";

export type MoodInsightsConfig = {
  readonly window_days: number;
  readonly min_days_with_mood: number;
  readonly min_group_days: number;
  readonly min_gap: number;
  readonly max_patterns: number;
}

export const moodInsightsConfig = (): MoodInsightsConfig => getProposedConfig<MoodInsightsConfig>("wellbeing.mood_insights").value;

export type MoodInsightKind = "sleep" | "tag" | "bp" | "weekday";
export type MoodInsightTemplate = "insights.tpl.sleep" | "insights.tpl.tag" | "insights.tpl.bp" | "insights.tpl.weekday";

export interface GroupCount {
  /** Days in this group whose mood was below the patient's own usual (median). */
  readonly low: number;
  readonly total: number;
}

export interface MoodInsight {
  readonly kind: MoodInsightKind;
  readonly template: MoodInsightTemplate;
  /** Set for kind "tag" (one of the fixed check-in tags) and "weekday" (0 = Sunday). */
  readonly tag?: string;
  readonly weekday?: number;
  /** The day group the sentence is about (A) and every other day with the same kind of data (B). */
  readonly a: GroupCount;
  readonly b: GroupCount;
  /** Share of below-usual days in A minus the share in B (-1 to 1). */
  readonly gap: number;
  /** Sleep: the patient's own middle night, in hours (one decimal). */
  readonly medianSleepHours?: number;
}

export interface MoodInsightsResult {
  readonly status: "not_enough_data" | "ok";
  readonly daysWithMood: number;
  readonly neededDays: number;
  readonly windowDays: number;
  /** The patient's own middle mood (1 to 5) over the window. null when there is no mood at all. */
  readonly medianMood: number | null;
  readonly insights: readonly MoodInsight[];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const weekdayName = (n: number): string => WEEKDAYS[((n % 7) + 7) % 7] ?? "";

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] as number;
  return s.length % 2 === 1 ? hi : ((s[mid - 1] as number) + hi) / 2;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 0 = Sunday, from a Lagos calendar day string (noon UTC avoids any edge). */
const weekdayOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

const count = (days: readonly MoodTrendDay[], below: (d: MoodTrendDay) => boolean): GroupCount => ({ low: days.filter(below).length, total: days.length });
const share = (g: GroupCount): number => (g.total === 0 ? 0 : g.low / g.total);

/** Day strings are YYYY-MM-DD so a string compare is a date compare. `asOf` defaults to the newest day in the data. */
export function moodInsights(days: readonly MoodTrendDay[], opts: { asOf?: string; config?: MoodInsightsConfig } = {}): MoodInsightsResult {
  const cfg = opts.config ?? moodInsightsConfig();
  const newest = days.reduce((m, d) => (d.day > m ? d.day : m), "");
  const asOf = opts.asOf ?? newest;
  const cutoff = asOf === "" ? "" : new Date(new Date(`${asOf}T12:00:00Z`).getTime() - cfg.window_days * 86_400_000).toISOString().slice(0, 10);
  const inWindow = days.filter((d) => d.day > cutoff && d.day <= (asOf === "" ? "9999" : asOf));
  const moodDays = inWindow.filter((d) => d.mood !== null);
  const base = { daysWithMood: moodDays.length, neededDays: cfg.min_days_with_mood, windowDays: cfg.window_days };
  const med = median(moodDays.map((d) => d.mood as number));
  if (moodDays.length < cfg.min_days_with_mood || med === null) return { status: "not_enough_data", ...base, medianMood: med === null ? null : round1(med), insights: [] };

  const below = (d: MoodTrendDay): boolean => (d.mood as number) < med;
  const found: MoodInsight[] = [];
  const consider = (partial: Omit<MoodInsight, "a" | "b" | "gap">, inGroup: readonly MoodTrendDay[], outGroup: readonly MoodTrendDay[]): void => {
    if (inGroup.length < cfg.min_group_days || outGroup.length < cfg.min_group_days) return;
    const a = count(inGroup, below);
    const b = count(outGroup, below);
    const gap = share(a) - share(b);
    if (Math.abs(gap) < cfg.min_gap) return;
    found.push({ ...partial, a, b, gap: Math.round(gap * 1000) / 1000 });
  };

  // Mood against sleep: the patient's own middle night splits the days.
  const withSleep = moodDays.filter((d) => d.sleepMinutes !== null);
  const medSleep = median(withSleep.map((d) => d.sleepMinutes as number));
  if (medSleep !== null) {
    consider({ kind: "sleep", template: "insights.tpl.sleep", medianSleepHours: round1(medSleep / 60) },
      withSleep.filter((d) => (d.sleepMinutes as number) < medSleep), withSleep.filter((d) => (d.sleepMinutes as number) >= medSleep));
  }
  // Mood against each tag the patient chose.
  const tags = new Set(moodDays.flatMap((d) => d.tags));
  for (const tag of [...tags].sort()) {
    consider({ kind: "tag", template: "insights.tpl.tag", tag }, moodDays.filter((d) => d.tags.includes(tag)), moodDays.filter((d) => !d.tags.includes(tag)));
  }
  // Mood against blood pressure the same day: the patient's own middle top number splits the days.
  const withBp = moodDays.filter((d) => d.systolic !== null);
  const medSys = median(withBp.map((d) => d.systolic as number));
  if (medSys !== null) {
    consider({ kind: "bp", template: "insights.tpl.bp" }, withBp.filter((d) => (d.systolic as number) > medSys), withBp.filter((d) => (d.systolic as number) <= medSys));
  }
  // Mood against day of week.
  for (let w = 0; w < 7; w++) {
    consider({ kind: "weekday", template: "insights.tpl.weekday", weekday: w }, moodDays.filter((d) => weekdayOf(d.day) === w), moodDays.filter((d) => weekdayOf(d.day) !== w));
  }

  found.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap) || x.kind.localeCompare(y.kind) || (x.tag ?? "").localeCompare(y.tag ?? "") || (x.weekday ?? 0) - (y.weekday ?? 0));
  return { status: "ok", ...base, medianMood: round1(med), insights: found.slice(0, cfg.max_patterns) };
}

/** Fills a sentence template through the caller's translator (the i18n catalogue lives in another package). */
export function renderInsight(
  insight: MoodInsight,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  const params: Record<string, string | number> = {
    totalA: insight.a.total, lowA: insight.a.low, totalB: insight.b.total, lowB: insight.b.low,
  };
  if (insight.kind === "sleep") params.median = insight.medianSleepHours ?? 0;
  if (insight.kind === "tag") params.tag = translate(`mood.tag.${insight.tag ?? "other"}`);
  if (insight.kind === "weekday") params.weekday = translate(`insights.weekday.${((insight.weekday ?? 0) % 7 + 7) % 7}`);
  return translate(insight.template, params);
}
