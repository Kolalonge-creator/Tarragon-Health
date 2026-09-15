import {
  daysBetween,
  type CyclePhase,
  type ObservedPeriod,
} from "./cycle-prediction";

/**
 * Turns a pile of daily logs into "your cramps usually start on day 1".
 *
 * This is the half of a cycle tracker that makes the logging worth doing.
 * Without it a patient types symptoms into a form for months and the app
 * never tells her anything back, which is the fastest way to stop somebody
 * logging.
 *
 * Pure, no clock reads, no DB — same discipline as cycle-prediction.ts.
 *
 * ## What it will and will not claim
 *
 * A pattern here is a description of what the patient herself recorded, not
 * a finding. It never says a symptom is caused by a phase, never infers a
 * diagnosis, and never feeds risk or escalation scoring. It also refuses to
 * speak on thin evidence: a symptom seen in one cycle is an anecdote, not a
 * pattern, and is reported as nothing at all rather than as a shaky
 * headline. That restraint is the whole difference between a useful insight
 * and an app inventing a story about somebody's body.
 */

/** Minimum cycles a symptom must appear in before it is called a pattern. */
const MIN_CYCLES_FOR_PATTERN = 2;

/** How many recent cycles are considered. Matches the prediction window. */
const HISTORY_WINDOW = 6;

export interface DailyLogEntry {
  date: string;
  symptoms: string[];
  moods: string[];
}

export type InsightKind = "symptom" | "mood";

export interface CycleInsight {
  /** The enum value, e.g. "cramps". */
  key: string;
  kind: InsightKind;
  /** How many of the observed cycles it appeared in at least once. */
  cyclesWithIt: number;
  /** How many complete cycles the logs actually cover. */
  cyclesObserved: number;
  /** Typical window within the cycle, as day numbers (day 1 = period start). */
  typicalStartDay: number;
  typicalEndDay: number;
  /** Median cycle day, the single best "when" answer. */
  medianDay: number;
  /** Where in the cycle it usually falls. */
  phase: CyclePhase;
  /** How often, as a fraction of observed cycles. */
  frequency: number;
}

export interface CycleInsightsInput {
  periods: ObservedPeriod[];
  dailyLogs: DailyLogEntry[];
  today: string;
  /** Used to place a day into a phase; from the prediction engine. */
  expectedCycleLengthDays: number;
  averagePeriodDurationDays: number | null;
}

interface CycleWindow {
  index: number;
  start: string;
  /** Inclusive. */
  end: string;
}

/** Consecutive period starts define cycle boundaries; the last runs to today. */
function buildCycleWindows(periods: ObservedPeriod[], today: string): CycleWindow[] {
  const starts = [...new Set(periods.map((p) => p.startDate))].sort();
  const windows: CycleWindow[] = [];
  starts.forEach((start, i) => {
    const next = starts[i + 1];
    const end = next
      ? new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      : today;
    if (end >= start) windows.push({ index: i, start, end });
  });
  // Only the recent window, and only cycles that actually closed or are the
  // current one — a 200-day gap is not a cycle anybody has symptoms "in".
  return windows
    .filter((w) => daysBetween(w.start, w.end) <= 90)
    .slice(-HISTORY_WINDOW);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Percentile by nearest rank, so the reported window is a real observed day. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1))));
  return sorted[rank];
}

/**
 * Which phase a cycle day falls in. A simplified version of the prediction
 * engine's phase logic: this one answers "where does day N usually sit",
 * not "where is she right now".
 */
function phaseForDay(
  day: number,
  cycleLength: number,
  periodDays: number
): CyclePhase {
  if (day <= periodDays) return "menstrual";
  const luteal = Math.min(14, Math.max(8, cycleLength - 10));
  const ovulationDay = cycleLength - luteal;
  if (day === ovulationDay) return "ovulation";
  if (day >= ovulationDay - 5 && day <= ovulationDay + 1) return "fertile";
  if (day > ovulationDay) return "luteal";
  return "follicular";
}

export function computeCycleInsights(input: CycleInsightsInput): CycleInsight[] {
  const windows = buildCycleWindows(input.periods, input.today);
  if (windows.length < MIN_CYCLES_FOR_PATTERN) return [];

  const periodDays = Math.round(input.averagePeriodDurationDays ?? 5);

  // key -> cycleIndex -> the cycle days it was logged on
  const seen = new Map<string, { kind: InsightKind; byCycle: Map<number, number[]> }>();

  for (const log of input.dailyLogs) {
    const window = windows.find((w) => log.date >= w.start && log.date <= w.end);
    if (!window) continue;
    const cycleDay = daysBetween(window.start, log.date) + 1;
    if (cycleDay < 1) continue;

    const record = (key: string, kind: InsightKind) => {
      let entry = seen.get(key);
      if (!entry) {
        entry = { kind, byCycle: new Map() };
        seen.set(key, entry);
      }
      const days = entry.byCycle.get(window.index) ?? [];
      days.push(cycleDay);
      entry.byCycle.set(window.index, days);
    };

    for (const symptom of log.symptoms ?? []) record(symptom, "symptom");
    for (const mood of log.moods ?? []) record(mood, "mood");
  }

  const insights: CycleInsight[] = [];
  for (const [key, entry] of seen) {
    const cyclesWithIt = entry.byCycle.size;
    if (cyclesWithIt < MIN_CYCLES_FOR_PATTERN) continue;

    const allDays = [...entry.byCycle.values()].flat();
    const start = percentile(allDays, 0.25);
    const end = percentile(allDays, 0.75);
    const mid = median(allDays);

    insights.push({
      key,
      kind: entry.kind,
      cyclesWithIt,
      cyclesObserved: windows.length,
      typicalStartDay: start,
      typicalEndDay: end,
      medianDay: mid,
      phase: phaseForDay(mid, input.expectedCycleLengthDays, periodDays),
      frequency: cyclesWithIt / windows.length,
    });
  }

  // Most consistent first: what happens nearly every cycle is the thing worth
  // reading, and a tie goes to the tighter (more predictable) window.
  return insights.sort(
    (a, b) =>
      b.frequency - a.frequency ||
      a.typicalEndDay - a.typicalStartDay - (b.typicalEndDay - b.typicalStartDay) ||
      a.key.localeCompare(b.key)
  );
}

/**
 * One sentence per insight, in the patient's own terms.
 *
 * Kept beside the computation so the hedging cannot drift away from the
 * numbers it is hedging about.
 */
export function describeInsight(insight: CycleInsight, label: string): string {
  const when =
    insight.typicalStartDay === insight.typicalEndDay
      ? `around day ${insight.medianDay}`
      : `around days ${insight.typicalStartDay} to ${insight.typicalEndDay}`;
  const howOften =
    insight.cyclesWithIt === insight.cyclesObserved
      ? `every one of your last ${insight.cyclesObserved} cycles`
      : `${insight.cyclesWithIt} of your last ${insight.cyclesObserved} cycles`;
  return `${label}: usually ${when}, in ${howOften}.`;
}
