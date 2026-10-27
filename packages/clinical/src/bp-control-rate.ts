/**
 * Home blood pressure control rate (S07x follow-up): of the home readings a patient took over a period, how many were inside the patient's
 * own target. A description for the care team and for the patient's own monthly summary, never a diagnosis and never a grade.
 *
 *  - Same gate as every other home average (`bp.average_gate`, rules of minReadings / minDays / minPerDay): below it there is NO rate and
 *    NO average, only a plain "not enough readings yet". A thin handful is never presented as control.
 *  - Same counting as the home average: a reading closer than `minGapMinutes` to the previous counted one is the same measurement saved
 *    twice and is not counted; days are Lagos calendar days (fixed UTC+1).
 *  - "In target" means systolic below AND diastolic below the target's two limits (the same strict comparison `hbpm_summary` uses for
 *    `at_target`, and the same "below" reading of `PersonalBpTarget`). A reading that is not a finite number is ignored.
 *  - Readings are the patient's own home readings. The result says how many were counted so a reader can see what it rests on.
 */

export interface ControlReading {
  systolic: number;
  diastolic: number;
  /** UTC milliseconds, the resolved effective time of the reading. */
  atMs: number;
}

export interface ControlTarget {
  /** Home readings below both limits are in target. */
  systolicBelow: number;
  diastolicBelow: number;
}

export interface ControlGateRule {
  minReadings: number;
  minDays: number;
  minPerDay: number;
}

export interface BpControlRate {
  /** Readings counted (inside the period, close duplicates removed). */
  counted: number;
  days: number;
  gateMet: boolean;
  /** Null until the gate is met. */
  inTarget: number | null;
  /** Whole percent of counted readings in target. Null until the gate is met. */
  percentInTarget: number | null;
  /** Mean of counted readings, whole numbers. Null until the gate is met. */
  meanSystolic: number | null;
  meanDiastolic: number | null;
  periodStart: string;
  periodEnd: string;
}

const LAGOS_OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;

const lagosDate = (ms: number): string => new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

function gateMet(countsByDay: readonly number[], rules: readonly ControlGateRule[]): boolean {
  return rules.some((rule) => {
    const qualifying = countsByDay.filter((c) => c >= rule.minPerDay);
    const used = qualifying.reduce((a, b) => a + b, 0);
    return qualifying.length >= rule.minDays && used >= rule.minReadings;
  });
}

const mean = (values: number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** `periodDays` Lagos days ending on the day of `nowMs` (inclusive). */
export function computeBpControlRate(args: {
  readings: readonly ControlReading[];
  target: ControlTarget;
  gateRules: readonly ControlGateRule[];
  nowMs: number;
  periodDays: number;
  minGapMinutes: number;
}): BpControlRate {
  const periodEnd = lagosDate(args.nowMs);
  const periodStart = lagosDate(args.nowMs - (args.periodDays - 1) * DAY_MS);

  const candidates = args.readings
    .filter((r) => Number.isFinite(r.systolic) && Number.isFinite(r.diastolic) && Number.isFinite(r.atMs))
    .filter((r) => {
      const d = lagosDate(r.atMs);
      return d >= periodStart && d <= periodEnd;
    })
    .sort((a, b) => a.atMs - b.atMs);

  const minGapMs = args.minGapMinutes * 60_000;
  const counted: ControlReading[] = [];
  for (const r of candidates) {
    const last = counted[counted.length - 1];
    if (last && r.atMs - last.atMs < minGapMs) continue;
    counted.push(r);
  }

  const perDay = new Map<string, number>();
  for (const r of counted) perDay.set(lagosDate(r.atMs), (perDay.get(lagosDate(r.atMs)) ?? 0) + 1);
  const met = counted.length > 0 && gateMet([...perDay.values()], args.gateRules);

  if (!met) {
    return {
      counted: counted.length,
      days: perDay.size,
      gateMet: false,
      inTarget: null,
      percentInTarget: null,
      meanSystolic: null,
      meanDiastolic: null,
      periodStart,
      periodEnd,
    };
  }
  const inTarget = counted.filter((r) => r.systolic < args.target.systolicBelow && r.diastolic < args.target.diastolicBelow).length;
  return {
    counted: counted.length,
    days: perDay.size,
    gateMet: true,
    inTarget,
    percentInTarget: Math.round((inTarget / counted.length) * 100),
    meanSystolic: mean(counted.map((r) => r.systolic)),
    meanDiastolic: mean(counted.map((r) => r.diastolic)),
    periodStart,
    periodEnd,
  };
}
