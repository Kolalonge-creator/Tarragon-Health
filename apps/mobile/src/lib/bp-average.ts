import { addDays, lagosHour, lagosLocalDate, type LocalDate } from "./lagos-date";
import type { AverageGateConfig, HomeProtocolConfig } from "./s07-config";

/**
 * Home blood pressure averages for S07. Pure and descriptive: it groups
 * readings into Lagos days, splits morning from evening, and decides whether
 * there are enough readings to show an average at all. It never grades a
 * reading (grading is S11/S12, OQ-67) and never says "controlled".
 *
 * An average is shown only when the gate is met (PROPOSED rule, versioned in
 * bp.average_gate). Below the gate the app says "not enough readings yet" and
 * `shortfall` says how many more days are needed, so a thin average is never
 * presented as a trend.
 *
 * `atMs` is the resolved effective time of the reading (S06-1: device time
 * inside the trusted window, else server time), never the raw `taken_at`.
 */
export interface HomeBpReading {
  systolic: number;
  diastolic: number;
  /** Resolved effective time, UTC milliseconds. */
  atMs: number;
}

export type SessionPart = "morning" | "evening" | "other";

export interface PartSummary {
  count: number;
  meanSystolic: number;
  meanDiastolic: number;
}

export interface DaySummary {
  localDate: LocalDate;
  count: number;
  meanSystolic: number;
  meanDiastolic: number;
  morning: PartSummary | null;
  evening: PartSummary | null;
}

export interface GateResult {
  met: boolean;
  /** Days that hold enough readings under the closest rule. */
  qualifyingDays: number;
  readingsUsed: number;
  /** Null when met. Otherwise how much more the closest rule needs. */
  shortfall: { moreDays: number; moreReadings: number; minPerDay: number } | null;
}

export interface HomeAverage {
  readings: number;
  days: number;
  systolic: number;
  diastolic: number;
}

export interface HomeBpSummary {
  windowStart: LocalDate;
  windowEnd: LocalDate;
  readingsInWindow: number;
  byDay: DaySummary[];
  gate: GateResult;
  /** Null until the gate is met. */
  average: HomeAverage | null;
  /** Session averages are shown only with the gate met and at least one reading in that session. */
  morningAverage: PartSummary | null;
  eveningAverage: PartSummary | null;
}

export function sessionPart(atMs: number, protocol: Pick<HomeProtocolConfig, "morningHours" | "eveningHours">): SessionPart {
  const h = lagosHour(atMs);
  if (h >= protocol.morningHours[0] && h < protocol.morningHours[1]) return "morning";
  if (h >= protocol.eveningHours[0] && h < protocol.eveningHours[1]) return "evening";
  return "other";
}

function mean(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function partOf(readings: HomeBpReading[]): PartSummary | null {
  if (readings.length === 0) return null;
  return {
    count: readings.length,
    meanSystolic: mean(readings.map((r) => r.systolic)),
    meanDiastolic: mean(readings.map((r) => r.diastolic)),
  };
}

export function evaluateAverageGate(countsByDay: readonly number[], gate: AverageGateConfig): GateResult {
  let best: GateResult | null = null;
  for (const rule of gate.rules) {
    const qualifying = countsByDay.filter((c) => c >= rule.minPerDay);
    const used = qualifying.reduce((a, b) => a + b, 0);
    const moreDays = Math.max(0, rule.minDays - qualifying.length);
    const moreReadings = Math.max(0, rule.minReadings - used);
    const met = moreDays === 0 && moreReadings === 0;
    const candidate: GateResult = {
      met,
      qualifyingDays: qualifying.length,
      readingsUsed: used,
      shortfall: met ? null : { moreDays, moreReadings, minPerDay: rule.minPerDay },
    };
    if (met) return candidate;
    if (
      best === null ||
      (candidate.shortfall && best.shortfall &&
        (candidate.shortfall.moreDays < best.shortfall.moreDays ||
          (candidate.shortfall.moreDays === best.shortfall.moreDays &&
            candidate.shortfall.moreReadings < best.shortfall.moreReadings)))
    ) {
      best = candidate;
    }
  }
  return best ?? { met: false, qualifyingDays: 0, readingsUsed: 0, shortfall: null };
}

export function summariseHomeBp(
  readings: readonly HomeBpReading[],
  nowMs: number,
  protocol: HomeProtocolConfig,
  gate: AverageGateConfig,
): HomeBpSummary {
  const windowEnd = lagosLocalDate(nowMs);
  const windowStart = addDays(windowEnd, -(gate.windowDays - 1));

  const inWindow = readings.filter((r) => {
    if (!Number.isFinite(r.systolic) || !Number.isFinite(r.diastolic) || !Number.isFinite(r.atMs)) return false;
    const d = lagosLocalDate(r.atMs);
    return d >= windowStart && d <= windowEnd;
  });

  const groups = new Map<LocalDate, HomeBpReading[]>();
  for (const r of inWindow) {
    const d = lagosLocalDate(r.atMs);
    const g = groups.get(d);
    if (g) g.push(r);
    else groups.set(d, [r]);
  }

  const byDay: DaySummary[] = [...groups.keys()].sort().map((localDate) => {
    const list = groups.get(localDate) ?? [];
    return {
      localDate,
      count: list.length,
      meanSystolic: mean(list.map((r) => r.systolic)),
      meanDiastolic: mean(list.map((r) => r.diastolic)),
      morning: partOf(list.filter((r) => sessionPart(r.atMs, protocol) === "morning")),
      evening: partOf(list.filter((r) => sessionPart(r.atMs, protocol) === "evening")),
    };
  });

  const gateResult = evaluateAverageGate(byDay.map((d) => d.count), gate);
  const all = inWindow;
  const average: HomeAverage | null = gateResult.met
    ? {
        readings: all.length,
        days: byDay.length,
        systolic: mean(all.map((r) => r.systolic)),
        diastolic: mean(all.map((r) => r.diastolic)),
      }
    : null;

  return {
    windowStart,
    windowEnd,
    readingsInWindow: all.length,
    byDay,
    gate: gateResult,
    average,
    morningAverage: gateResult.met ? partOf(all.filter((r) => sessionPart(r.atMs, protocol) === "morning")) : null,
    eveningAverage: gateResult.met ? partOf(all.filter((r) => sessionPart(r.atMs, protocol) === "evening")) : null,
  };
}
