import {
  formatGlucose,
  GLUCOSE_UNIT_LABEL,
  HOME_PIN_LABEL,
  isHomeValuePin,
  isSeriesPin,
  readingDetail,
  type GlucoseDisplayUnit,
  type HomePinKey,
  type HomePinVitalValue,
  type HomeValuePinKey,
  type PinSeries,
  type SparkPoint,
} from "@tarragon/shared";
import type { DoseDay, DoseHistory } from "@tarragon/medicines";
import type { SummaryStats } from "./overview";
import type { QueryResult } from "./medications";
import type { PinSeriesMap } from "./reading-series";

/** What one big-number tile on Home shows. Words only; the tile component draws it. */
export interface TileContent {
  label: string;
  value?: string;
  unit?: string;
  empty?: string;
  detail?: string | null;
  points?: SparkPoint[];
  /** The last 7 completed days of doses, for the small bars on the doses tile. */
  doseDays?: DoseDay[];
}

export interface TileInputs {
  stats: SummaryStats;
  glucoseUnit: GlucoseDisplayUnit;
  vitalValues: Partial<Record<HomeValuePinKey, HomePinVitalValue>>;
  vitalsFailed: boolean;
  /** Null while the trends are still loading. */
  trends: { nowMs: number; series: PinSeriesMap; doses: QueryResult<DoseHistory> | null } | null;
}

const TREND_FAILED = "Couldn't load the last 30 days";

/** The when-and-trend line and the line's points for a vitals pin; a failed series read says so instead of drawing nothing. */
function trendParts(pin: HomePinKey, trends: TileInputs["trends"]): { detail: string | null; points?: SparkPoint[] } {
  if (!trends || !isSeriesPin(pin)) return { detail: null };
  const s: PinSeries | "failed" | undefined = trends.series[pin];
  if (s === "failed") return { detail: TREND_FAILED };
  if (!s) return { detail: null };
  return { detail: readingDetail(s, trends.nowMs), points: s.points };
}

/**
 * Home's pinned tiles as big numbers (2026-11-06, the phone twin of the web's home-pin-tiles.tsx): the same labels, the same
 * "no reading yet" and "couldn't load" rules, the trend word and when, and the doses-taken bars. A failed read never looks like
 * an empty state.
 */
export function homeTileContent(pin: HomePinKey, input: TileInputs): TileContent {
  const { stats, glucoseUnit, vitalValues, vitalsFailed, trends } = input;
  switch (pin) {
    case "bp":
      return {
        label: "Blood pressure",
        ...(stats.latestBp ? { value: `${stats.latestBp.systolic}/${stats.latestBp.diastolic}`, unit: "mmHg" } : { empty: "No reading yet" }),
        ...trendParts(pin, trends),
      };
    case "glucose": {
      const shown = formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false });
      return {
        label: "Blood sugar",
        ...(shown ? { value: shown, unit: GLUCOSE_UNIT_LABEL[glucoseUnit] } : { empty: "No reading yet" }),
        ...trendParts(pin, trends),
      };
    }
    case "active_meds":
      return { label: "Active medicines", ...(stats.activeMedicationCount === 0 ? { empty: "None on your list yet" } : { value: String(stats.activeMedicationCount) }) };
    case "doses_today": {
      // dosesTotal counts scheduled slots, so 0 means "nothing is due today", not "none taken".
      const today = stats.dosesTotal === 0 ? "Nothing due today" : `Today: ${stats.dosesTaken} of ${stats.dosesTotal} so far`;
      const doses = trends?.doses;
      if (!doses || !doses.ok) {
        // The week could not be worked out (or is still loading): today's count still loaded, so it leads.
        return {
          label: "Doses today",
          ...(stats.dosesTotal === 0 ? { empty: "Nothing due today" } : { value: `${stats.dosesTaken} of ${stats.dosesTotal}` }),
          detail: doses && !doses.ok ? "The last 7 days couldn't load just now" : null,
        };
      }
      const week = doses.data.last7;
      return {
        label: "Doses, last 7 days",
        ...(week.percent !== null
          ? { value: `${week.percent}%`, unit: `${week.taken} of ${week.due}` }
          : { empty: week.due === 0 ? "Nothing was due" : `${week.taken} of ${week.due} marked taken` }),
        detail: today,
        ...(week.due > 0 ? { doseDays: doses.data.days.slice(-7) } : {}),
      };
    }
    case "screenings":
      return { label: HOME_PIN_LABEL[pin], empty: "Tap to open" };
    default: {
      if (isHomeValuePin(pin)) {
        const reading = vitalValues[pin];
        // A failed read must not look like "no reading yet": a real reading may exist.
        const hint = vitalsFailed ? "Couldn't load, tap to open" : "No reading yet";
        return { label: HOME_PIN_LABEL[pin], ...(reading ? { value: reading.value, unit: reading.unit } : { empty: hint }), ...trendParts(pin, trends) };
      }
      // A shortcut: the screen it opens has the detail, so the tile does not pretend to a number.
      return { label: HOME_PIN_LABEL[pin], empty: "Tap to open" };
    }
  }
}
