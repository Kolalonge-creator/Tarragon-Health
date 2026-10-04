import type { MessageKey } from "@tarragon/i18n";
import { summariseHomeBp, type AveragingProtocol, type GateResult, type HomeAverage, type PartSummary } from "./bp-average";
import { bandStatus, resolveTargetBand, trendDisplayMode, type BandStatus, type PersonalBpTarget, type TrendDisplay } from "./bp-trend-rules";
import { lagosLocalDate, weekdayOf, type LocalDate } from "./lagos-date";
import type { AverageGateConfig, StartingSuggestionTarget, TrendDisplayConfig } from "./s07-config";
import { windowReadings, type TrendWindowDays } from "./bp-trend";
import type { BpReading } from "./vitals";

/**
 * Everything the trends card shows besides the chart itself (S07): the target
 * line, an average only when there are enough readings, and a per-day list.
 * Pure: no drawing, no copy, no clock of its own.
 *
 * Rules:
 * - An average appears only past the averaging gate; below it the model carries
 *   what is missing instead, so a thin average is never shown as a trend.
 * - Fewer readings than the chart minimum means a list, not a line.
 * - Statuses against the target exist only when the care team has set a target
 *   (confirmed). Without one, no reading or day is called above or not above:
 *   the server falls back to its own derived target (135/85, or 130/80 with
 *   diabetes, kidney or heart disease), so a flat guess here could contradict a
 *   clinician alert. See OQ-73.
 * - A day is "above" when ANY of its readings was at or above the target, the
 *   same per-reading rule the server uses, so a day average can never hide a
 *   high reading.
 * - "Not above" is deliberately not "within range": the target has no lower
 *   limit, so a very low reading is also "not above". Nothing here says "good",
 *   "controlled" or "improving".
 * - Times are the readings' effective times (S06-1), bucketed by Lagos day.
 */
/** Weekday labels, index 0 = Sunday. Its own keys, so this does not depend on the reminders screen. */
export const WEEKDAY_KEYS: readonly MessageKey[] = [
  "trends.weekday.0",
  "trends.weekday.1",
  "trends.weekday.2",
  "trends.weekday.3",
  "trends.weekday.4",
  "trends.weekday.5",
  "trends.weekday.6",
];

export interface DayRow {
  localDate: LocalDate;
  weekdayKey: MessageKey;
  /** DD/MM */
  dayMonth: string;
  count: number;
  meanSystolic: number;
  meanDiastolic: number;
  morning: PartSummary | null;
  evening: PartSummary | null;
  /** Readings at or above the target that day, or null when there is no confirmed target. */
  aboveCount: number | null;
  status: BandStatus | null;
}

export interface TrendInsights {
  displayMode: TrendDisplay;
  readingCount: number;
  /** The care team's target when confirmed; otherwise only that none is set. */
  target: { confirmed: true; systolicBelow: number; diastolicBelow: number } | { confirmed: false };
  average: HomeAverage | null;
  morningAverage: PartSummary | null;
  eveningAverage: PartSummary | null;
  /** What is still needed for an average, or null when there is one. */
  shortfall: GateResult["shortfall"];
  /** Readings not counted because they were taken within the protocol gap of another. */
  ignoredClose: number;
  /** Newest day first. */
  days: DayRow[];
}

export interface TrendInsightsInput {
  readings: readonly BpReading[];
  nowMs: number;
  windowDays: TrendWindowDays;
  personal: PersonalBpTarget | null;
  protocol: AveragingProtocol;
  gate: AverageGateConfig;
  display: TrendDisplayConfig;
  suggestion: StartingSuggestionTarget;
}

export function buildTrendInsights(input: TrendInsightsInput): TrendInsights {
  const band = resolveTargetBand(input.personal, input.suggestion);
  const confirmed = band.confirmed;

  // Exactly the readings the chart draws: the same window function, applied first. The Lagos-day
  // window inside summariseHomeBp is then widened by a day so it can only include more, never
  // fewer, than that. Without this a reading from the afternoon of the earliest day could be in
  // the chart but missing from the card, and the chart hidden: a reading in neither.
  const summary = summariseHomeBp(
    windowReadings([...input.readings], input.windowDays, input.nowMs).map((r) => ({
      systolic: r.systolic,
      diastolic: r.diastolic,
      atMs: Date.parse(r.takenAt),
    })),
    input.nowMs,
    input.protocol,
    { ...input.gate, windowDays: input.windowDays + 1 },
  );

  const aboveByDay = new Map<LocalDate, number>();
  if (confirmed) {
    for (const r of summary.readings) {
      if (bandStatus(r.systolic, r.diastolic, band) === "above") {
        const d = lagosLocalDate(r.atMs);
        aboveByDay.set(d, (aboveByDay.get(d) ?? 0) + 1);
      }
    }
  }

  const days: DayRow[] = [...summary.byDay]
    .sort((a, b) => b.localDate.localeCompare(a.localDate))
    .map((d) => {
      const above = confirmed ? (aboveByDay.get(d.localDate) ?? 0) : null;
      return {
        localDate: d.localDate,
        weekdayKey: WEEKDAY_KEYS[weekdayOf(d.localDate)] as MessageKey,
        dayMonth: `${d.localDate.slice(8, 10)}/${d.localDate.slice(5, 7)}`,
        count: d.count,
        meanSystolic: d.meanSystolic,
        meanDiastolic: d.meanDiastolic,
        morning: d.morning,
        evening: d.evening,
        aboveCount: above,
        status: above === null ? null : above > 0 ? "above" : "not_above",
      };
    });

  return {
    displayMode: trendDisplayMode(summary.readings.length, input.display),
    readingCount: summary.readings.length,
    target: confirmed
      ? { confirmed: true, systolicBelow: band.systolicBelow, diastolicBelow: band.diastolicBelow }
      : { confirmed: false },
    average: summary.average,
    morningAverage: summary.morningAverage,
    eveningAverage: summary.eveningAverage,
    shortfall: summary.gate.shortfall,
    ignoredClose: summary.ignoredCloseReadings,
    days,
  };
}
