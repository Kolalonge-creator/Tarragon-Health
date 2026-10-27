/**
 * S47b (BUILD-SPEC-v5 4.5): the weekly summary cards. Four small cards, each describing what the person logged in the last seven days: blood pressure,
 * activity against her own weekly goal, meals logged and medicines marked taken.
 *
 * Rules:
 *  - It reports what was logged, in plain words. It never calls a number good or bad, never diagnoses and never compares one person with another.
 *  - Each card uses the figure the rest of the platform already uses: the person's own blood pressure target (the one her alerts use), the S48a weekly
 *    active-minutes progress, the S49a food diary, and the adherence formula in @tarragon/medicines (`buildAdherenceReport`, the same one the printed
 *    adherence report and the care team's chart use). This file only turns those figures into cards; it recomputes none of them.
 *  - Too little to say (fewer readings than the configured minimum, too few doses due) is a calm "not enough yet" card, never a zero or a shame line.
 *  - Pure: no clock, no network, no language model. Copy is keys in @tarragon/i18n, English only.
 */
import type { MessageKey } from "@tarragon/i18n";

export type WeeklyCardCode = "blood_pressure" | "activity" | "meals" | "medicines";

export interface WeeklyConfig {
  readonly minBpReadings: number;
  readonly windowDays: number;
}

export class WeeklyConfigError extends Error {}

/** Reads the weekly part of the `today.home_cards` configuration, or throws. */
export function parseWeeklyConfig(value: unknown): WeeklyConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new WeeklyConfigError("weekly must be an object");
  const raw = value as Record<string, unknown>;
  const minBp = raw["min_bp_readings"];
  const days = raw["window_days"];
  if (typeof minBp !== "number" || !Number.isInteger(minBp) || minBp < 1) throw new WeeklyConfigError("weekly.min_bp_readings must be a whole number of at least 1");
  if (days !== 7) throw new WeeklyConfigError("weekly.window_days must be 7: the cards are weekly");
  return { minBpReadings: minBp, windowDays: days };
}

export interface WeeklyInput {
  /** Cuff readings from the last seven Lagos days with the person's own target. Null when the source could not be read. */
  readonly bloodPressure: {
    readonly readings: readonly { readonly systolic: number; readonly diastolic: number }[];
    /** Readings count as "under target" when both numbers are below these. Null when there is no target to compare with. */
    readonly target: { readonly systolicBelow: number; readonly diastolicBelow: number } | null;
  } | null;
  /** The S48a week: minutes against the weekly goal. Null when the person has no goal or it could not be read. */
  readonly activity: { readonly activeMinutes: number; readonly goalMinutes: number } | null;
  /** Days in the last seven on which at least one meal was logged. Null when the food diary could not be read. */
  readonly meals: { readonly daysLogged: number } | null;
  /** From buildAdherenceReport for the last seven completed days. Null when the person has no scheduled medicine or it could not be read. */
  readonly medicines: { readonly due: number; readonly markedTaken: number; readonly percent: number | null } | null;
}

export interface WeeklyLine {
  readonly key: MessageKey;
  readonly params?: Record<string, string | number>;
}

export interface WeeklyCard {
  readonly code: WeeklyCardCode;
  readonly state: "ready" | "not_enough";
  readonly title: WeeklyLine;
  readonly line: WeeklyLine;
}

export interface WeeklySummary {
  readonly cards: readonly WeeklyCard[];
}

export function buildWeeklySummary(cfg: WeeklyConfig, input: WeeklyInput): WeeklySummary {
  const cards: WeeklyCard[] = [];

  if (input.bloodPressure) {
    const { readings, target } = input.bloodPressure;
    const title: WeeklyLine = { key: "weekly.bp.title" };
    if (readings.length < cfg.minBpReadings) {
      cards.push({ code: "blood_pressure", state: "not_enough", title, line: { key: "weekly.bp.not_enough", params: { min: cfg.minBpReadings } } });
    } else if (!target) {
      cards.push({ code: "blood_pressure", state: "ready", title, line: { key: "weekly.bp.no_target", params: { count: readings.length } } });
    } else {
      const under = readings.filter((r) => r.systolic < target.systolicBelow && r.diastolic < target.diastolicBelow).length;
      cards.push({ code: "blood_pressure", state: "ready", title, line: { key: "weekly.bp.ready", params: { count: readings.length, under } } });
    }
  }

  if (input.activity && input.activity.goalMinutes > 0) {
    cards.push({
      code: "activity",
      state: "ready",
      title: { key: "weekly.activity.title" },
      line: { key: "weekly.activity.ready", params: { minutes: input.activity.activeMinutes, goal: input.activity.goalMinutes } },
    });
  }

  if (input.meals) {
    cards.push({
      code: "meals",
      state: "ready",
      title: { key: "weekly.meals.title" },
      line: input.meals.daysLogged > 0 ? { key: "weekly.meals.ready", params: { days: input.meals.daysLogged } } : { key: "weekly.meals.none" },
    });
  }

  if (input.medicines && input.medicines.due > 0) {
    const title: WeeklyLine = { key: "weekly.medicines.title" };
    cards.push(
      input.medicines.percent === null
        ? { code: "medicines", state: "not_enough", title, line: { key: "weekly.medicines.not_enough" } }
        : { code: "medicines", state: "ready", title, line: { key: "weekly.medicines.ready", params: { taken: input.medicines.markedTaken, due: input.medicines.due } } },
    );
  }

  return { cards };
}
