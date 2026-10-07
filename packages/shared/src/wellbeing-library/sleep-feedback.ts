/**
 * Weekly sleep feedback (S57, function 10.10). DELIBERATELY has no single score and no advice: it reports separate plain numbers
 * and the difference from the week before, so nobody is given a number to be anxious about (orthosomnia) and nobody is told to
 * spend less time in bed (that is a clinical intervention, not self-help). The smallest change worth mentioning is PROPOSED config
 * (`media_library.config` sleep_feedback.change_epsilon_pct).
 */
export interface SleepDiaryEntry {
  readonly logged_on: string; // YYYY-MM-DD
  readonly duration_hours: number; // time asleep
  readonly bedtime?: string | null; // HH:MM or HH:MM:SS
  readonly waketime?: string | null;
  readonly sleep_latency_minutes?: number | null;
  readonly night_awakenings?: number | null;
}

export type Trend = "higher" | "lower" | "about_the_same" | "not_enough_data";

export interface WeeklySleepFeedback {
  readonly nights: number;
  readonly averageSleepHours: number | null;
  readonly averageInBedHours: number | null;
  /** Time asleep as a share of time in bed, 0 to 100, over nights where both are known. */
  readonly sleepShareOfTimeInBedPct: number | null;
  readonly earliestBedtime: string | null;
  readonly latestBedtime: string | null;
  readonly averageMinutesToFallAsleep: number | null;
  readonly averageNightWakings: number | null;
  readonly shareTrend: Trend;
  readonly sleepTrend: Trend;
}

function minutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}

/** Hours between bedtime and wake time across midnight. */
export function hoursInBed(bedtime: string | null | undefined, waketime: string | null | undefined): number | null {
  const b = minutes(bedtime);
  const w = minutes(waketime);
  if (b === null || w === null) return null;
  const d = (w - b + 24 * 60) % (24 * 60);
  return d === 0 ? null : d / 60;
}

function avg(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}
const r1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

function shareOf(e: SleepDiaryEntry): number | null {
  const bed = hoursInBed(e.bedtime, e.waketime);
  if (bed === null) return null;
  return Math.min(100, (e.duration_hours / bed) * 100);
}

function trend(now: number | null, before: number | null, epsilon: number): Trend {
  if (now === null || before === null) return "not_enough_data";
  const d = now - before;
  if (Math.abs(d) <= epsilon) return "about_the_same";
  return d > 0 ? "higher" : "lower";
}

function fmt(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function weeklySleepFeedback(thisWeek: readonly SleepDiaryEntry[], lastWeek: readonly SleepDiaryEntry[], epsilonPct: number): WeeklySleepFeedback {
  const shares = thisWeek.map(shareOf).filter((x): x is number => x !== null);
  const prevShares = lastWeek.map(shareOf).filter((x): x is number => x !== null);
  const inBed = thisWeek.map((e) => hoursInBed(e.bedtime, e.waketime)).filter((x): x is number => x !== null);
  const beds = thisWeek.map((e) => minutes(e.bedtime)).filter((x): x is number => x !== null);
  const avgSleep = avg(thisWeek.map((e) => e.duration_hours));
  const prevSleep = avg(lastWeek.map((e) => e.duration_hours));
  // Hours compared against the same epsilon read as percentage points of a night's 8 hours would be an invented scale, so sleep
  // duration is compared in hours with the epsilon read as a share of an hour: kept simple and shown to the person as a difference.
  return {
    nights: thisWeek.length,
    averageSleepHours: r1(avgSleep),
    averageInBedHours: r1(avg(inBed)),
    sleepShareOfTimeInBedPct: shares.length ? Math.round(avg(shares) as number) : null,
    earliestBedtime: beds.length ? fmt(Math.min(...beds)) : null,
    latestBedtime: beds.length ? fmt(Math.max(...beds)) : null,
    averageMinutesToFallAsleep: (() => {
      const v = avg(thisWeek.map((e) => e.sleep_latency_minutes).filter((x): x is number => typeof x === "number"));
      return v === null ? null : Math.round(v);
    })(),
    averageNightWakings: r1(avg(thisWeek.map((e) => e.night_awakenings).filter((x): x is number => typeof x === "number"))),
    shareTrend: trend(shares.length ? (avg(shares) as number) : null, prevShares.length ? (avg(prevShares) as number) : null, epsilonPct),
    sleepTrend: trend(avgSleep, prevSleep, epsilonPct / 10),
  };
}

/** The message keys the screens may use for a feedback (i18n `sleep.weekly.*`). Kept here so a test can scan them for advice. */
export const SLEEP_WEEKLY_MESSAGE_KEYS = [
  "sleep.weekly.title",
  "sleep.weekly.nights",
  "sleep.weekly.average_sleep",
  "sleep.weekly.average_in_bed",
  "sleep.weekly.share",
  "sleep.weekly.bedtime_range",
  "sleep.weekly.fall_asleep",
  "sleep.weekly.wakings",
  "sleep.weekly.trend_higher",
  "sleep.weekly.trend_lower",
  "sleep.weekly.trend_same",
  "sleep.weekly.trend_unknown",
  "sleep.weekly.no_score_note",
  "sleep.weekly.talk_to_care_team",
] as const;
