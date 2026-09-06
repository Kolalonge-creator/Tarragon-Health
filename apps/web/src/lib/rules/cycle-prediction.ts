import type { Enums } from "@tarragon/shared";

/**
 * Menstrual cycle prediction engine.
 *
 * Pure, no DB access, no clock reads (today is always passed in) — same
 * discipline as bp-classification/findrisc/cvd-risk-afro, so it is fully
 * unit-testable and safe to re-run on every render.
 *
 * This replaces the single nudge in lib/rules/cycle-nudges.ts, which
 * estimated the next period as `last_period_date + average_cycle_length`
 * with a hardcoded 28-day fallback. That is wrong in three ways that matter
 * to somebody actually using it:
 *
 *   1. It used a self-reported average that nobody updates, rather than the
 *      patient's own observed history.
 *   2. It gave a single date with no uncertainty, so it read as a promise.
 *   3. It never said anything about ovulation or the fertile window, which
 *      is most of why somebody tracks a cycle at all.
 *
 * ## Why ovulation is counted BACKWARDS from the next period
 *
 * The common shortcut — ovulation is the midpoint of the cycle — is the
 * single biggest source of error in naive cycle apps. It is wrong because
 * the two halves of the cycle are not equally variable: the follicular
 * phase (period start -> ovulation) stretches and shrinks a lot between
 * people and between cycles, while the luteal phase (ovulation -> next
 * period) is comparatively fixed at about 14 days. So for a 35-day cycle,
 * midpoint says day 17 and luteal-phase counting says day 21 — and the
 * evidence is with day 21. We therefore anchor ovulation to the PREDICTED
 * NEXT PERIOD, not to the last one.
 *
 * ## Honest degradation
 *
 * Every output carries a confidence level, and the predicted window widens
 * as the history gets thinner or more variable. When a period is overdue
 * past the predicted window we say so plainly instead of quietly rolling
 * the estimate forward, which is what makes a tracker feel broken.
 *
 * ## Not contraception, not a diagnosis
 *
 * A calculated fertile window is a calendar estimate, not a contraceptive
 * method and not a fertility treatment. Callers must render it as such (see
 * FERTILE_WINDOW_DISCLAIMER). Cycle data is never fed into risk or
 * escalation scoring — the clinical flags below are a separate, explicit
 * output that a human reads, the same discipline mental_health_screens and
 * lifestyle_assessments follow.
 */

export type ReproductiveLifeStage = Enums<"reproductive_life_stage">;

// ---------------------------------------------------------------------------
// Clinical constants
// ---------------------------------------------------------------------------

/**
 * Luteal phase length used to back-count ovulation. 14 days is the
 * conventional figure; the real range is roughly 11-17 days, which is part
 * of why the fertile window is a window and not a day.
 */
export const LUTEAL_PHASE_DAYS = 14;

/**
 * The fertile window spans the 5 days before ovulation plus ovulation day
 * itself plus the day after: sperm survive up to ~5 days in fertile cervical
 * mucus, and the ovum is viable for roughly 24 hours after release.
 */
export const FERTILE_DAYS_BEFORE_OVULATION = 5;
export const FERTILE_DAYS_AFTER_OVULATION = 1;

/**
 * FIGO/ACOG normal ranges for menstrual cycle frequency. Outside these, the
 * terms are "frequent" (<24) and "infrequent" (>38) menstruation — both of
 * which are reasons to talk to a clinician, not emergencies.
 */
export const NORMAL_CYCLE_MIN_DAYS = 24;
export const NORMAL_CYCLE_MAX_DAYS = 38;

/**
 * FIGO 2018 regularity criterion: shortest-to-longest cycle variation within
 * a 12-month period. Up to 9 days of swing is still called regular.
 */
export const REGULAR_VARIATION_MAX_DAYS = 9;

/** Normal duration of menstrual bleeding. Over 8 days is "prolonged". */
export const NORMAL_PERIOD_MAX_DAYS = 8;

/**
 * No period for 90+ days in somebody who menstruates and is not pregnant is
 * secondary amenorrhoea, and is worth a clinical conversation.
 */
export const AMENORRHOEA_DAYS = 90;

/**
 * Cycles outside this range are almost certainly a missed log rather than a
 * real cycle (a 120-day "cycle" usually means the patient stopped logging
 * for a few months). They are excluded from the average but counted as a
 * data-quality signal, so one gap does not poison every future prediction.
 */
const PLAUSIBLE_CYCLE_MIN_DAYS = 15;
const PLAUSIBLE_CYCLE_MAX_DAYS = 90;

/** How many recent cycles feed the prediction. */
const HISTORY_WINDOW = 6;

/** Used only when there is no observed history at all. */
const DEFAULT_CYCLE_LENGTH_DAYS = 28;

/** Assumed bleeding length when a period has no recorded end date. */
const DEFAULT_PERIOD_DURATION_DAYS = 5;

export const FERTILE_WINDOW_DISCLAIMER =
  "This is a calendar estimate from your logged cycles. It is not a contraceptive method and cannot confirm whether you ovulated.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObservedPeriod {
  /** ISO date (YYYY-MM-DD) bleeding started. */
  startDate: string;
  /** ISO date bleeding ended, or null if ongoing or not recorded. */
  endDate: string | null;
}

/** How confident the prediction is, and therefore how it should be worded. */
export type CycleConfidence = "none" | "low" | "medium" | "high";

/** FIGO regularity classification over the cycles we can see. */
export type CycleRegularity = "regular" | "irregular" | "unknown";

export type CyclePhase =
  | "menstrual"
  | "follicular"
  | "fertile"
  | "ovulation"
  | "luteal"
  | "unknown";

export type CycleFlagSeverity = "info" | "discuss" | "urgent";

export interface CycleClinicalFlag {
  id: string;
  severity: CycleFlagSeverity;
  /** Patient-facing, plain, non-alarming. */
  label: string;
  /** What to actually do about it. */
  detail: string;
}

export interface CycleStats {
  /** Number of complete cycles derived from consecutive period starts. */
  observedCycles: number;
  /** Cycles that survived the plausibility filter and fed the prediction. */
  usedCycles: number;
  /** Cycle lengths used, oldest first. */
  cycleLengths: number[];
  shortestCycleDays: number | null;
  longestCycleDays: number | null;
  /** Shortest-to-longest swing, the FIGO regularity measure. */
  variationDays: number | null;
  averageCycleLengthDays: number | null;
  averagePeriodDurationDays: number | null;
  regularity: CycleRegularity;
}

export interface CyclePrediction {
  stats: CycleStats;
  confidence: CycleConfidence;
  /** Why the confidence is what it is — rendered to the patient verbatim. */
  confidenceReason: string;
  /** The cycle length the prediction actually used. */
  expectedCycleLengthDays: number;
  lastPeriodStartDate: string | null;
  /** Day 1 = first day of the last logged period. Null with no history. */
  currentCycleDay: number | null;
  currentPhase: CyclePhase;
  predictedNextPeriodDate: string | null;
  /** Inclusive uncertainty band around predictedNextPeriodDate. */
  predictedNextPeriodEarliest: string | null;
  predictedNextPeriodLatest: string | null;
  /** Positive once today is past predictedNextPeriodDate. */
  daysUntilNextPeriod: number | null;
  /** True only once today is past the whole window, not merely past the point estimate. */
  isOverdue: boolean;
  daysOverdue: number | null;
  predictedOvulationDate: string | null;
  fertileWindowStart: string | null;
  fertileWindowEnd: string | null;
  flags: CycleClinicalFlag[];
}

export interface CyclePredictionInput {
  /** Observed bleeding episodes, any order. */
  periods: ObservedPeriod[];
  /** ISO date to evaluate against. Always passed in, never read from a clock. */
  today: string;
  lifeStage: ReproductiveLifeStage;
  /**
   * The patient's self-reported average, used only as a fallback before
   * there is enough observed history to beat it.
   */
  selfReportedCycleLengthDays?: number | null;
  /** Dates the patient logged flooding-level flow, for the heavy-bleeding flag. */
  heavyFlowDates?: string[];
}

// ---------------------------------------------------------------------------
// Date helpers (UTC-only, so no timezone can shift a date across midnight)
// ---------------------------------------------------------------------------

function toUtc(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(toUtc(isoDate));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtc(value));
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Drops single outlier cycles before averaging — one stressful month or one
 * late log should not drag every future prediction with it. Only applied
 * with 4+ cycles, and never below 3 survivors, so a genuinely variable
 * cycle is reported as variable rather than smoothed into a false calm.
 */
function trimOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const average = mean(values);
  const deviation = standardDeviation(values);
  if (deviation === 0) return values;
  const kept = values.filter((value) => Math.abs(value - average) <= 2 * deviation);
  return kept.length >= 3 ? kept : values;
}

/**
 * Recency-weighted mean: the most recent cycle carries the most weight, so
 * a cycle length that is genuinely drifting (postpartum, perimenopause,
 * a new contraceptive) is followed rather than averaged away.
 */
function weightedMean(values: number[]): number {
  let weightedSum = 0;
  let weightTotal = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    weightedSum += value * weight;
    weightTotal += weight;
  });
  return weightedSum / weightTotal;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Sorted, de-duplicated, validated periods. */
function normalisePeriods(periods: ObservedPeriod[]): ObservedPeriod[] {
  const seen = new Map<string, ObservedPeriod>();
  for (const period of periods) {
    if (!period?.startDate || !isValidIsoDate(period.startDate)) continue;
    const endDate =
      period.endDate && isValidIsoDate(period.endDate) && period.endDate >= period.startDate
        ? period.endDate
        : null;
    // A duplicate start date is a double-log, not two periods. Prefer the
    // row that actually knows when the bleeding stopped.
    const existing = seen.get(period.startDate);
    if (!existing || (!existing.endDate && endDate)) {
      seen.set(period.startDate, { startDate: period.startDate, endDate });
    }
  }
  return [...seen.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function computeStats(periods: ObservedPeriod[]): CycleStats {
  const cycleLengths: number[] = [];
  for (let index = 0; index < periods.length - 1; index += 1) {
    cycleLengths.push(daysBetween(periods[index].startDate, periods[index + 1].startDate));
  }

  const plausible = cycleLengths.filter(
    (length) => length >= PLAUSIBLE_CYCLE_MIN_DAYS && length <= PLAUSIBLE_CYCLE_MAX_DAYS
  );
  const recent = plausible.slice(-HISTORY_WINDOW);

  const durations = periods
    .filter((period) => period.endDate)
    .map((period) => daysBetween(period.startDate, period.endDate as string) + 1)
    // Deliberately tighter than the database's 30-day typo guard, and the
    // difference is intentional: the table must be able to STORE a genuine
    // three-week bleed (the prolonged-bleeding flag reads the raw dates and
    // still fires on it), while "your typical period length" should not be
    // dragged upwards by one abnormal episode. Storing and averaging are
    // different questions; do not "reconcile" these two numbers.
    .filter((duration) => duration >= 1 && duration <= 15);

  const shortest = recent.length ? Math.min(...recent) : null;
  const longest = recent.length ? Math.max(...recent) : null;
  const variation = shortest !== null && longest !== null ? longest - shortest : null;

  let regularity: CycleRegularity = "unknown";
  if (recent.length >= 3 && variation !== null) {
    regularity = variation <= REGULAR_VARIATION_MAX_DAYS ? "regular" : "irregular";
  }

  const averageCycle = recent.length
    ? Math.round(weightedMean(trimOutliers(recent)) * 10) / 10
    : null;

  return {
    observedCycles: cycleLengths.length,
    usedCycles: recent.length,
    cycleLengths: recent,
    shortestCycleDays: shortest,
    longestCycleDays: longest,
    variationDays: variation,
    averageCycleLengthDays: averageCycle,
    averagePeriodDurationDays: durations.length
      ? Math.round(mean(durations) * 10) / 10
      : null,
    regularity,
  };
}

function resolveConfidence(
  stats: CycleStats,
  hasHistory: boolean
): { confidence: CycleConfidence; reason: string } {
  if (!hasHistory) {
    return {
      confidence: "none",
      reason: "Log your first period to start seeing estimates.",
    };
  }
  if (stats.usedCycles === 0) {
    return {
      confidence: "none",
      reason:
        "Log the start of your next period and we can begin estimating from your own cycles.",
    };
  }
  if (stats.regularity === "irregular") {
    return {
      confidence: "low",
      reason: `Your recent cycles vary by ${stats.variationDays} days, so treat these dates as a rough guide.`,
    };
  }
  if (stats.usedCycles <= 2) {
    return {
      confidence: "low",
      reason: `Based on ${stats.usedCycles} cycle${stats.usedCycles === 1 ? "" : "s"} so far. Estimates get sharper with each period you log.`,
    };
  }
  if (stats.usedCycles <= 5) {
    return {
      confidence: "medium",
      reason: `Based on your last ${stats.usedCycles} cycles, which have been fairly consistent.`,
    };
  }
  return {
    confidence: "high",
    reason: `Based on your last ${stats.usedCycles} cycles, which have been consistent.`,
  };
}

/**
 * Half-width of the predicted window. Driven by how much the patient's own
 * cycles actually move, floored so we never imply day-level precision and
 * capped so the window stays useful rather than covering half the month.
 */
function predictionHalfWidth(stats: CycleStats): number {
  if (stats.usedCycles === 0) return 5;
  if (stats.usedCycles < 3) return 4;
  const deviation = standardDeviation(stats.cycleLengths);
  return Math.min(7, Math.max(1, Math.round(deviation)));
}

function resolvePhase(
  today: string,
  lastPeriod: ObservedPeriod,
  periodDuration: number,
  ovulationDate: string | null,
  fertileStart: string | null,
  fertileEnd: string | null
): CyclePhase {
  const bleedingEnd = lastPeriod.endDate ?? addDays(lastPeriod.startDate, periodDuration - 1);
  if (today >= lastPeriod.startDate && today <= bleedingEnd) return "menstrual";
  if (ovulationDate && today === ovulationDate) return "ovulation";
  if (fertileStart && fertileEnd && today >= fertileStart && today <= fertileEnd) {
    return "fertile";
  }
  if (ovulationDate && today > ovulationDate) return "luteal";
  if (today > bleedingEnd) return "follicular";
  return "unknown";
}

function computeFlags(
  input: CyclePredictionInput,
  periods: ObservedPeriod[],
  stats: CycleStats
): CycleClinicalFlag[] {
  const flags: CycleClinicalFlag[] = [];
  const lastPeriod = periods[periods.length - 1] ?? null;

  // Bleeding after menopause is the one finding here that is genuinely
  // urgent: it is treated as endometrial cancer until proven otherwise,
  // whatever the eventual cause turns out to be.
  if (input.lifeStage === "menopausal" && lastPeriod) {
    flags.push({
      id: "postmenopausal_bleeding",
      severity: "urgent",
      label: "Bleeding after menopause always needs to be checked",
      detail:
        "You have recorded bleeding while your life stage is set to menopausal. This is not usually serious, but it is always investigated. Please contact your care team now.",
    });
  }

  if (
    input.lifeStage === "menstruating" &&
    lastPeriod &&
    daysBetween(lastPeriod.startDate, input.today) >= AMENORRHOEA_DAYS
  ) {
    flags.push({
      id: "amenorrhoea",
      severity: "discuss",
      label: `No period logged for ${daysBetween(lastPeriod.startDate, input.today)} days`,
      detail:
        "Three months or more without a period has a lot of possible causes, from pregnancy to thyroid or hormonal changes. Worth a conversation with your care team.",
    });
  }

  if (stats.averageCycleLengthDays !== null && stats.usedCycles >= 3) {
    if (stats.averageCycleLengthDays < NORMAL_CYCLE_MIN_DAYS) {
      flags.push({
        id: "short_cycles",
        severity: "discuss",
        label: `Your cycles are averaging ${stats.averageCycleLengthDays} days`,
        detail: `Cycles shorter than ${NORMAL_CYCLE_MIN_DAYS} days are worth mentioning to your care team, especially if this is new for you.`,
      });
    } else if (stats.averageCycleLengthDays > NORMAL_CYCLE_MAX_DAYS) {
      flags.push({
        id: "long_cycles",
        severity: "discuss",
        label: `Your cycles are averaging ${stats.averageCycleLengthDays} days`,
        detail: `Cycles longer than ${NORMAL_CYCLE_MAX_DAYS} days are common with conditions like PCOS and thyroid changes. Worth raising with your care team.`,
      });
    }
  }

  if (stats.regularity === "irregular" && stats.variationDays !== null) {
    flags.push({
      id: "irregular_cycles",
      severity: "info",
      label: `Your cycle length varies by ${stats.variationDays} days`,
      detail:
        "Some variation is completely normal. Keep logging, and mention it at your next review if it bothers you or is new.",
    });
  }

  const prolonged = periods.filter(
    (period) =>
      period.endDate && daysBetween(period.startDate, period.endDate) + 1 > NORMAL_PERIOD_MAX_DAYS
  );
  if (prolonged.length > 0) {
    flags.push({
      id: "prolonged_bleeding",
      severity: "discuss",
      label: `You have logged bleeding lasting more than ${NORMAL_PERIOD_MAX_DAYS} days`,
      detail:
        "Periods lasting over a week can lead to low iron over time. Worth mentioning to your care team so they can check.",
    });
  }

  if ((input.heavyFlowDates?.length ?? 0) >= 2) {
    flags.push({
      id: "heavy_bleeding",
      severity: "discuss",
      label: "You have logged very heavy flow on more than one day",
      detail:
        "Heavy periods are common and very treatable, but they can cause low iron. Your care team can check your blood count and talk through options.",
    });
  }

  return flags;
}

export function predictCycle(input: CyclePredictionInput): CyclePrediction {
  const periods = normalisePeriods(input.periods);
  const stats = computeStats(periods);
  const { confidence, reason } = resolveConfidence(stats, periods.length > 0);
  const flags = computeFlags(input, periods, stats);

  const lastPeriod = periods[periods.length - 1] ?? null;

  // Prefer the patient's own observed history; fall back to what they told
  // us; fall back to 28 only when we know nothing at all.
  const selfReported =
    input.selfReportedCycleLengthDays &&
    input.selfReportedCycleLengthDays >= PLAUSIBLE_CYCLE_MIN_DAYS &&
    input.selfReportedCycleLengthDays <= 60
      ? input.selfReportedCycleLengthDays
      : null;
  const expectedCycleLengthDays = Math.round(
    stats.averageCycleLengthDays ?? selfReported ?? DEFAULT_CYCLE_LENGTH_DAYS
  );

  if (!lastPeriod) {
    return {
      stats,
      confidence,
      confidenceReason: reason,
      expectedCycleLengthDays,
      lastPeriodStartDate: null,
      currentCycleDay: null,
      currentPhase: "unknown",
      predictedNextPeriodDate: null,
      predictedNextPeriodEarliest: null,
      predictedNextPeriodLatest: null,
      daysUntilNextPeriod: null,
      isOverdue: false,
      daysOverdue: null,
      predictedOvulationDate: null,
      fertileWindowStart: null,
      fertileWindowEnd: null,
      flags,
    };
  }

  const predictedNextPeriodDate = addDays(lastPeriod.startDate, expectedCycleLengthDays);
  const halfWidth = predictionHalfWidth(stats);
  const predictedNextPeriodEarliest = addDays(predictedNextPeriodDate, -halfWidth);
  const predictedNextPeriodLatest = addDays(predictedNextPeriodDate, halfWidth);

  // Ovulation counted back from the NEXT period, not forward from the last
  // one — see the note at the top of this file. The luteal length is
  // shortened only for implausibly short cycles, so that ovulation never
  // lands during the period itself.
  const lutealDays = Math.min(LUTEAL_PHASE_DAYS, Math.max(8, expectedCycleLengthDays - 10));
  const predictedOvulationDate = addDays(predictedNextPeriodDate, -lutealDays);
  const fertileWindowStart = addDays(predictedOvulationDate, -FERTILE_DAYS_BEFORE_OVULATION);
  const fertileWindowEnd = addDays(predictedOvulationDate, FERTILE_DAYS_AFTER_OVULATION);

  const periodDuration = Math.round(
    stats.averagePeriodDurationDays ?? DEFAULT_PERIOD_DURATION_DAYS
  );
  const currentCycleDay = daysBetween(lastPeriod.startDate, input.today) + 1;
  const daysUntilNextPeriod = daysBetween(input.today, predictedNextPeriodDate);
  const isOverdue = input.today > predictedNextPeriodLatest;

  return {
    stats,
    confidence,
    confidenceReason: reason,
    expectedCycleLengthDays,
    lastPeriodStartDate: lastPeriod.startDate,
    // A negative cycle day means today is before the last logged period,
    // which is a data-entry situation, not a cycle position.
    currentCycleDay: currentCycleDay >= 1 ? currentCycleDay : null,
    currentPhase:
      currentCycleDay >= 1
        ? resolvePhase(
            input.today,
            lastPeriod,
            periodDuration,
            predictedOvulationDate,
            fertileWindowStart,
            fertileWindowEnd
          )
        : "unknown",
    predictedNextPeriodDate,
    predictedNextPeriodEarliest,
    predictedNextPeriodLatest,
    daysUntilNextPeriod,
    isOverdue,
    daysOverdue: isOverdue ? daysBetween(predictedNextPeriodDate, input.today) : null,
    predictedOvulationDate,
    fertileWindowStart,
    fertileWindowEnd,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (kept here so wording stays with the logic it describes)
// ---------------------------------------------------------------------------

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: "Period",
  follicular: "Follicular phase",
  fertile: "Fertile window",
  ovulation: "Ovulation (estimated)",
  luteal: "Luteal phase",
  unknown: "Not enough information yet",
};

/**
 * The one-line answer to "when is my next period", worded for the state the
 * prediction is actually in.
 *
 * It lives here, next to the logic, rather than inline in the ring component,
 * because it shipped a real bug while it was inline: once today passes the
 * point estimate but is still inside the uncertainty window,
 * daysUntilNextPeriod goes negative while isOverdue is still false, and that
 * branch fell through to "Log a period to begin" -- telling somebody with six
 * logged cycles that she had logged nothing. Every branch below is tested.
 */
export function nextPeriodSummary(prediction: CyclePrediction): string {
  if (!prediction.predictedNextPeriodDate) return "Log a period to begin";
  if (prediction.isOverdue) return "since your estimated date";
  const daysUntil = prediction.daysUntilNextPeriod;
  if (daysUntil === null || daysUntil < 0) return "Expected any day now";
  if (daysUntil === 0) return "Expected around today";
  return `${daysUntil} ${daysUntil === 1 ? "day" : "days"} to your next period`;
}

export const PHASE_DESCRIPTION: Record<CyclePhase, string> = {
  menstrual: "You are bleeding. Rest, fluids and pain relief if you need it.",
  follicular:
    "Your body is preparing to release an egg. Energy often picks up through this stretch.",
  fertile: "These are the days you are most likely to conceive if you are trying.",
  ovulation: "An egg is estimated to be released around today.",
  luteal:
    "The stretch before your next period. Cramps, mood changes and bloating are common here.",
  unknown: "Log a period and we can show you where you are in your cycle.",
};
