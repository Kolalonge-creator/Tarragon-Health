/**
 * Longitudinal synthesis — reading a body across time rather than one result at
 * a time.
 *
 * "Your creatinine has risen at three consecutive checks" is a sentence no
 * one-off lab visit in Nigeria will ever say to a patient, because a one-off
 * visit has no memory. This platform does. This engine is that memory made
 * legible.
 *
 * PURE functions, no I/O. Every finding is DESCRIPTIVE — direction, size, and
 * span of a movement — and never diagnostic. It says "this has risen at three
 * consecutive checks and is now above the usual range"; it never says what
 * condition that means, never names a drug, and never grades urgency. That
 * boundary is the same one `patient-explainer` and `case-briefs` hold: the
 * platform surfaces the pattern, a doctor interprets it.
 *
 * TWO AUDIENCES, ONE ENGINE. `describeForPatient` and `describeForClinician`
 * render the same computed finding differently — the patient gets plain warm
 * language with no reference numbers, the clinician gets values, dates and
 * percentages. They can never disagree about the underlying fact because there
 * is only one computation.
 */

import { getAnalyte, orientationRange } from "@/lib/lab-reports/analyte-catalogue";

export interface SeriesPoint {
  value: number;
  /** ISO timestamp. */
  takenAt: string;
}

export type TrendDirection = "rising" | "falling" | "stable";

export type TrendSignificance =
  /** Movement is within what repeat testing alone would produce. Not surfaced. */
  | "noise"
  /** A real, consistent movement, but still inside the usual range. */
  | "notable"
  /** A real movement that has taken the value outside the usual range, or was already outside and is getting worse. */
  | "outside_range";

/** §6.9 "variability": whether the WHOLE window (not just the monotonic run
 * analyseSeries anchors on) sits close to its own mean or swings widely. A
 * separate dimension from direction/persistence — a series can be
 * "improving" over its last three readings while still fluctuating overall. */
export type TrendVariability = "stable" | "fluctuating";

/** §6.9 "rate of change": how fast the run's movement happened, not just how
 * much. A 10% rise over 3 days reads very differently to clinicians than the
 * same 10% over 6 months. */
export type TrendRateOfChange = "gradual" | "rapid";

export interface TrendFinding {
  code: string;
  label: string;
  direction: TrendDirection;
  significance: TrendSignificance;
  /** How many readings in a row moved the same way, including the first. */
  consecutiveCount: number;
  firstValue: number;
  latestValue: number;
  firstTakenAt: string;
  latestTakenAt: string;
  /** Signed percentage change from first to latest across the run. */
  percentChange: number;
  unit: string;
  /** Whether the latest value sits outside the analyte's orientation band. */
  latestOutsideRange: boolean;
  /** The band used, when one was available for this analyte and sex. */
  range: { low: number; high: number } | null;
  /** Days spanned by the run. */
  spanDays: number;
  /** Null when there are too few points in the whole (not just the run)
   * series to say anything about spread. */
  variability: TrendVariability | null;
  rateOfChange: TrendRateOfChange;
}

/** Explicit config for a series analyseSeries has no catalogue entry for
 * (e.g. a home-monitored vital rather than a lab analyte) — see
 * lib/rules/vitals-trend.ts. When omitted, analyseSeries falls back to
 * looking `code` up in the lab analyte catalogue exactly as before; passing
 * this is what lets the SAME engine serve a series the catalogue has never
 * heard of, with no change to any existing caller. */
export interface SeriesConfig {
  label: string;
  unit: string;
  /** Minimum %, across the whole run, for a movement to count as real. */
  meaningfulChangePct: number;
  range?: { low: number; high: number } | null;
}

/** % change per day, across the run, above which a movement counts as
 * "rapid" rather than "gradual". Deliberately generic (not per-analyte) —
 * this is about the SHAPE of the change, not its clinical meaning. */
const RAPID_CHANGE_PCT_PER_DAY = 2;

/** Coefficient of variation (stddev / mean, as a %) above which a series
 * counts as "fluctuating" rather than "stable". */
const FLUCTUATING_CV_PCT = 15;

function classifyVariability(points: SeriesPoint[]): TrendVariability | null {
  if (points.length < MIN_POINTS_FOR_TREND) return null;
  const values = points.map((p) => p.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const cv = (Math.sqrt(variance) / Math.abs(mean)) * 100;
  return cv > FLUCTUATING_CV_PCT ? "fluctuating" : "stable";
}

function classifyRateOfChange(percentChange: number, spanDays: number): TrendRateOfChange {
  const perDay = spanDays > 0 ? Math.abs(percentChange) / spanDays : Math.abs(percentChange);
  return perDay >= RAPID_CHANGE_PCT_PER_DAY ? "rapid" : "gradual";
}

/**
 * Minimum percentage change, across the whole run, for a movement to count as
 * real rather than assay-and-biology noise.
 *
 * These are deliberately conservative. A false "your kidney function is
 * worsening" is not a harmless error — it frightens someone and burns a
 * doctor's time. Being quiet about a marginal drift is the safer failure, and
 * the next reading will surface it anyway if it is genuine.
 */
const MIN_MEANINGFUL_CHANGE_PCT: Record<string, number> = {
  creatinine: 15,
  urea: 25,
  bun: 25,
  urine_acr: 40,
  hba1c: 5,
  fasting_glucose: 12,
  random_glucose: 20,
  ogtt_2h_glucose: 15,
  total_cholesterol: 10,
  ldl_cholesterol: 12,
  hdl_cholesterol: 12,
  triglycerides: 25,
  alt: 40,
  ast: 40,
  alp: 25,
  total_bilirubin: 40,
  albumin: 10,
  haemoglobin: 8,
  haematocrit: 8,
  wbc: 25,
  platelets: 20,
  sodium: 3,
  potassium: 10,
  chloride: 4,
  bicarbonate: 12,
  tsh: 40,
  free_t4: 15,
  psa: 30,
  uric_acid: 15,
};

const DEFAULT_MIN_CHANGE_PCT = 20;

/** Minimum readings before a "trend" is a trend at all rather than two points. */
export const MIN_POINTS_FOR_TREND = 3;

/**
 * Find the longest run of consistently-moving readings ending at the MOST
 * RECENT one.
 *
 * Anchoring at the latest reading is deliberate: a rise three years ago that
 * has since corrected is history, not a finding. What matters clinically, and
 * what a patient is actually asking, is "what is happening to me now".
 */
export function analyseSeries(
  code: string,
  points: SeriesPoint[],
  options: { sex?: string | null; config?: SeriesConfig } = {},
): TrendFinding | null {
  const analyte = options.config ? null : getAnalyte(code);
  if (!analyte && !options.config) return null;
  const label = options.config?.label ?? analyte!.label;
  const unit = options.config?.unit ?? analyte!.canonicalUnit;

  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value) && !Number.isNaN(new Date(p.takenAt).getTime()))
    .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());

  if (sorted.length < MIN_POINTS_FOR_TREND) return null;

  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];

  const direction: TrendDirection =
    latest.value > previous.value ? "rising" : latest.value < previous.value ? "falling" : "stable";
  if (direction === "stable") return null;

  // Walk backwards while each step continues in the same direction.
  let startIndex = sorted.length - 2;
  while (startIndex > 0) {
    const step = sorted[startIndex];
    const before = sorted[startIndex - 1];
    const moved = direction === "rising" ? step.value > before.value : step.value < before.value;
    if (!moved) break;
    startIndex -= 1;
  }

  const run = sorted.slice(startIndex);
  if (run.length < MIN_POINTS_FOR_TREND) return null;

  const first = run[0];
  const percentChange =
    first.value === 0 ? 0 : ((latest.value - first.value) / Math.abs(first.value)) * 100;

  const range = options.config ? (options.config.range ?? null) : orientationRange(code, options.sex ?? null);
  const latestOutsideRange = range ? latest.value < range.low || latest.value > range.high : false;

  const threshold = options.config?.meaningfulChangePct ?? MIN_MEANINGFUL_CHANGE_PCT[code] ?? DEFAULT_MIN_CHANGE_PCT;
  let significance: TrendSignificance;
  if (Math.abs(percentChange) < threshold) {
    significance = "noise";
  } else if (latestOutsideRange) {
    significance = "outside_range";
  } else {
    significance = "notable";
  }

  const spanDays = Math.max(
    0,
    Math.round(
      (new Date(latest.takenAt).getTime() - new Date(first.takenAt).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );

  return {
    code,
    label,
    direction,
    significance,
    consecutiveCount: run.length,
    firstValue: first.value,
    latestValue: latest.value,
    firstTakenAt: first.takenAt,
    latestTakenAt: latest.takenAt,
    percentChange: Math.round(percentChange * 10) / 10,
    unit,
    latestOutsideRange,
    range,
    spanDays,
    variability: classifyVariability(sorted),
    rateOfChange: classifyRateOfChange(percentChange, spanDays),
  };
}

/**
 * Analyse a whole record at once — every analyte with enough history — and
 * return only the findings worth showing, most significant first.
 *
 * Noise-level movements are dropped here rather than by the caller, so no
 * surface can accidentally render a drift as a trend.
 */
export function analyseRecord(
  readings: { code: string; value: number; takenAt: string }[],
  options: { sex?: string | null } = {},
): TrendFinding[] {
  const byCode = new Map<string, SeriesPoint[]>();
  for (const r of readings) {
    const list = byCode.get(r.code) ?? [];
    list.push({ value: r.value, takenAt: r.takenAt });
    byCode.set(r.code, list);
  }

  const findings: TrendFinding[] = [];
  for (const [code, points] of byCode) {
    const finding = analyseSeries(code, points, options);
    if (finding && finding.significance !== "noise") findings.push(finding);
  }

  const rank: Record<TrendSignificance, number> = { outside_range: 0, notable: 1, noise: 2 };
  return findings.sort((a, b) => {
    const bySignificance = rank[a.significance] - rank[b.significance];
    if (bySignificance !== 0) return bySignificance;
    return Math.abs(b.percentChange) - Math.abs(a.percentChange);
  });
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatSpan(days: number): string {
  if (days < 45) return "the past few weeks";
  const months = Math.round(days / 30.44);
  if (months < 12) return `the past ${months} months`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (years === 1 && remainder === 0) return "the past year";
  if (remainder === 0) return `the past ${years} years`;
  return `the past ${years} year${years > 1 ? "s" : ""} and ${remainder} months`;
}

/**
 * Plain, warm, non-alarming language for the patient. No reference ranges, no
 * percentages, no numbers they have no way to interpret — the movement and its
 * shape, then their care team.
 *
 * Deliberately never says "normal", "fine", "abnormal", or "high" as a verdict.
 * "Above the usual range" is a statement about a band; "high" is a judgement.
 */
export function describeForPatient(finding: TrendFinding): string {
  const verb = finding.direction === "rising" ? "gone up" : "come down";
  const span = formatSpan(finding.spanDays);
  const base = `Your ${finding.label.toLowerCase()} has ${verb} at ${finding.consecutiveCount} checks in a row over ${span}.`;

  if (finding.significance === "outside_range") {
    return `${base} The most recent one is outside the range most adults sit in. This is the kind of pattern worth talking through with your care team, who can see the whole picture.`;
  }
  // Deliberately stops at the fact. Adding "so this is nothing to worry about"
  // would be a reassurance nobody here is in a position to give, and adding a
  // caveat would be a fear cue. The care team interprets; this describes.
  return `${base} It is still within the range most adults sit in. Your care team can tell you whether it matters for you.`;
}

/** Values, dates and magnitude for the clinician. Same fact, full detail. */
export function describeForClinician(finding: TrendFinding): string {
  const direction = finding.direction === "rising" ? "↑" : "↓";
  const sign = finding.percentChange > 0 ? "+" : "";
  const rangeNote = finding.range
    ? finding.latestOutsideRange
      ? ` Latest is outside the orientation band ${finding.range.low}–${finding.range.high} ${finding.unit}.`
      : ` Latest remains within ${finding.range.low}–${finding.range.high} ${finding.unit}.`
    : "";
  return (
    `${finding.label} ${direction} across ${finding.consecutiveCount} consecutive results: ` +
    `${finding.firstValue} → ${finding.latestValue} ${finding.unit} ` +
    `(${sign}${finding.percentChange}%) between ${formatMonthYear(finding.firstTakenAt)} and ${formatMonthYear(finding.latestTakenAt)}.${rangeNote}`
  );
}

/**
 * The single most important thing happening to this patient over time, or null.
 * Used where there is room for exactly one sentence — a dashboard card, a
 * notification, the top of a case brief.
 */
export function headlineFinding(findings: TrendFinding[]): TrendFinding | null {
  return findings.length > 0 ? findings[0] : null;
}
