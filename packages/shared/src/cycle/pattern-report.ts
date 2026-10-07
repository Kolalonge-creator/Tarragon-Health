import {
  NORMAL_CYCLE_MAX_DAYS,
  NORMAL_CYCLE_MIN_DAYS,
  daysBetween,
  predictCycle,
  type CycleClinicalFlag,
  type CycleRegularity,
  type ObservedPeriod,
  type ReproductiveLifeStage,
} from "./prediction";

/**
 * The clinician pattern report (S66, function 16.3): cycle-length variability, flow and symptoms, as numbers a clinician can read in
 * under a minute. Pure code, no clock, no database. The data arrives from the audited read function
 * `read_reproductive_pattern_report_audited` (INV-10, INV-12); nothing here fetches anything.
 *
 * Deliberately NOT in the report: the fertile window, ovulation date, basal temperature and ovulation test results (conception
 * planning data, decision A14), and the free-text notes (the patient's own words, not needed for a pattern). It never concludes
 * anything: the flags are the same plain prompts the patient sees ("worth discussing"), and every figure is "as logged".
 */

export interface PatternLogDay {
  /** ISO date. */
  date: string;
  flow: "none" | "spotting" | "light" | "medium" | "heavy" | "flooding" | null;
  symptoms: readonly string[];
  moods: readonly string[];
}

export interface PatternReportInput {
  periods: readonly ObservedPeriod[];
  logs: readonly PatternLogDay[];
  /** ISO date the report is for (always passed in). */
  today: string;
  lifeStage: ReproductiveLifeStage;
  /** How many months back the report covers. */
  windowMonths: number;
}

export interface PatternCycleRow {
  startDate: string;
  endDate: string | null;
  /** Days from this start to the next start, null for the latest period. */
  lengthDays: number | null;
  /** Inclusive bleeding duration when an end is recorded. */
  durationDays: number | null;
  outsideUsualRange: boolean;
}

export interface PatternCount {
  name: string;
  days: number;
  /** Share of logged days, whole percent. */
  percentOfLoggedDays: number;
}

export interface CyclePatternReport {
  coveredFrom: string;
  coveredTo: string;
  cycles: PatternCycleRow[];
  length: {
    count: number;
    meanDays: number | null;
    sdDays: number | null;
    minDays: number | null;
    maxDays: number | null;
    rangeDays: number | null;
    outsideUsualRangeCount: number;
    regularity: CycleRegularity;
  };
  flow: { loggedDays: number; byLevel: Record<string, number>; heavyOrFloodingDays: number; spottingDays: number };
  symptoms: PatternCount[];
  moods: PatternCount[];
  loggedDays: number;
  flags: CycleClinicalFlag[];
  /** What the report is and is not, printed on it. */
  statement: string;
}

export const PATTERN_REPORT_STATEMENT =
  "Figures are as logged by the patient and are not a diagnosis. Cycle length is the gap between logged period starts, so a missed log makes a cycle look longer. No fertility estimate is included.";

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleSd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs) as number;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function topCounts(source: readonly (readonly string[])[], loggedDays: number): PatternCount[] {
  const counts = new Map<string, number>();
  for (const day of source) for (const item of new Set(day)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, days]) => ({ name, days, percentOfLoggedDays: loggedDays === 0 ? 0 : Math.round((days / loggedDays) * 100) }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

export function buildCyclePatternReport(input: PatternReportInput): CyclePatternReport {
  const from = addMonths(input.today, -Math.max(1, Math.floor(input.windowMonths)));
  const sortedPeriods = [...input.periods].filter((p) => p.startDate >= from && p.startDate <= input.today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const logs = input.logs.filter((l) => l.date >= from && l.date <= input.today);

  const cycles: PatternCycleRow[] = sortedPeriods.map((p, i) => {
    const next = sortedPeriods[i + 1];
    const lengthDays = next ? daysBetween(p.startDate, next.startDate) : null;
    return {
      startDate: p.startDate,
      endDate: p.endDate,
      lengthDays,
      durationDays: p.endDate ? daysBetween(p.startDate, p.endDate) + 1 : null,
      outsideUsualRange: lengthDays !== null && (lengthDays < NORMAL_CYCLE_MIN_DAYS || lengthDays > NORMAL_CYCLE_MAX_DAYS),
    };
  });
  const lengths = cycles.flatMap((c) => (c.lengthDays === null ? [] : [c.lengthDays]));
  const m = mean(lengths);
  const sd = sampleSd(lengths);

  // Flags and regularity come from the one engine, with planning mode OFF so nothing fertility-related can enter a report.
  const prediction = predictCycle({
    periods: sortedPeriods,
    today: input.today,
    lifeStage: input.lifeStage,
    heavyFlowDates: logs.filter((l) => l.flow === "flooding").map((l) => l.date),
    conceptionPlanning: false,
  });

  const flowDays = logs.filter((l) => l.flow !== null);
  const byLevel: Record<string, number> = {};
  for (const l of flowDays) byLevel[l.flow as string] = (byLevel[l.flow as string] ?? 0) + 1;

  return {
    coveredFrom: from,
    coveredTo: input.today,
    cycles,
    length: {
      count: lengths.length,
      meanDays: m === null ? null : round1(m),
      sdDays: sd === null ? null : round1(sd),
      minDays: lengths.length ? Math.min(...lengths) : null,
      maxDays: lengths.length ? Math.max(...lengths) : null,
      rangeDays: lengths.length ? Math.max(...lengths) - Math.min(...lengths) : null,
      outsideUsualRangeCount: cycles.filter((c) => c.outsideUsualRange).length,
      regularity: prediction.stats.regularity,
    },
    flow: {
      loggedDays: flowDays.length,
      byLevel,
      heavyOrFloodingDays: (byLevel["heavy"] ?? 0) + (byLevel["flooding"] ?? 0),
      spottingDays: byLevel["spotting"] ?? 0,
    },
    symptoms: topCounts(logs.map((l) => l.symptoms), logs.length),
    moods: topCounts(logs.map((l) => l.moods), logs.length),
    loggedDays: logs.length,
    flags: prediction.flags,
    statement: PATTERN_REPORT_STATEMENT,
  };
}
