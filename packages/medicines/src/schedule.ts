import { addDays, daysBetween, isValidLocalDate, isValidTime, weekdayOf, type LocalDate } from "./lagos";
import type { FoodNote, ScheduleSpec, Slot, TaperStep } from "./types";

/**
 * Schedule model and expansion. A schedule is stored as a small JSON spec; this
 * module validates it and turns it into the dated dose slots of any day or
 * range. Times are Africa/Lagos wall-clock "HH:MM" strings, never UTC, so a dose
 * stays at 08:00 whatever the phone's timezone or clock says.
 *
 * The same expansion exists in SQL (`private.medication_slots_on`) for the
 * server missed-dose job and the refill estimate. The two are held together by
 * the shared cases in `schedule.fixtures.ts` (this package tests them, and the
 * database proof carries the same cases).
 */
const FOOD_NOTES: readonly FoodNote[] = ["with_food", "before_food", "after_food", "empty_stomach", "bedtime"];
const MAX_RANGE_DAYS = 400;
const MAX_TIMES_PER_DAY = 12;
const MAX_TAPER_STEPS = 24;
const MAX_INTERVAL_DAYS = 90;
const MAX_DOSE_TEXT = 80;

export type ParseResult = { ok: true; spec: ScheduleSpec } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanTimes(raw: unknown, errors: string[], field: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TIMES_PER_DAY) {
    errors.push(`${field}:count`);
    return [];
  }
  const bad = raw.some((t) => !isValidTime(t));
  if (bad) errors.push(`${field}:format`);
  const good = raw.filter(isValidTime);
  return [...new Set(good)].sort();
}

function optionalDate(raw: unknown, errors: string[], field: string): LocalDate | null {
  if (raw === undefined || raw === null) return null;
  if (!isValidLocalDate(raw)) {
    errors.push(`${field}:format`);
    return null;
  }
  return raw;
}

function parseTaperStep(raw: unknown, errors: string[], i: number): TaperStep {
  const step = isRecord(raw) ? raw : {};
  const days = step.days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 366) errors.push(`steps[${i}].days`);
  const times = cleanTimes(step.times, errors, `steps[${i}].times`);
  const doseText = typeof step.doseText === "string" ? step.doseText.trim() : "";
  if (doseText.length === 0 || doseText.length > MAX_DOSE_TEXT) errors.push(`steps[${i}].doseText`);
  return { days: typeof days === "number" ? days : 0, times, doseText };
}

/** Validate untrusted JSON (a database column, a form) into a ScheduleSpec. Never throws. */
export function parseScheduleSpec(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["spec:shape"] };

  const startDate = optionalDate(input.startDate, errors, "startDate");
  const endDate = optionalDate(input.endDate, errors, "endDate");
  if (startDate !== null && endDate !== null && endDate < startDate) errors.push("endDate:before_start");

  let foodNote: FoodNote | null = null;
  if (input.foodNote !== undefined && input.foodNote !== null) {
    if (FOOD_NOTES.includes(input.foodNote as FoodNote)) foodNote = input.foodNote as FoodNote;
    else errors.push("foodNote");
  }
  const common = { startDate, endDate, foodNote };

  let spec: ScheduleSpec | null = null;
  switch (input.kind) {
    case "daily":
      spec = { ...common, kind: "daily", times: cleanTimes(input.times, errors, "times") };
      break;
    case "every_n_days": {
      const n = input.intervalDays;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > MAX_INTERVAL_DAYS) errors.push("intervalDays");
      const anchorDate = optionalDate(input.anchorDate, errors, "anchorDate");
      if (anchorDate === null) errors.push("anchorDate:required");
      spec = {
        ...common,
        kind: "every_n_days",
        times: cleanTimes(input.times, errors, "times"),
        intervalDays: typeof n === "number" ? n : 0,
        anchorDate: anchorDate ?? "1970-01-01",
      };
      break;
    }
    case "weekdays": {
      const raw = input.days;
      const valid = Array.isArray(raw) && raw.length > 0 && raw.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (!valid) errors.push("days");
      spec = {
        ...common,
        kind: "weekdays",
        times: cleanTimes(input.times, errors, "times"),
        days: valid ? [...new Set(raw as number[])].sort((a, b) => a - b) : [],
      };
      break;
    }
    case "taper": {
      const raw = input.steps;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TAPER_STEPS) errors.push("steps:count");
      const steps = Array.isArray(raw) ? raw.slice(0, MAX_TAPER_STEPS).map((s, i) => parseTaperStep(s, errors, i)) : [];
      if (startDate === null) errors.push("startDate:required_for_taper");
      spec = { ...common, kind: "taper", steps };
      break;
    }
    case "as_needed": {
      const m = input.maxPerDay;
      let maxPerDay: number | null = null;
      if (m !== undefined && m !== null) {
        if (typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 24) maxPerDay = m;
        else errors.push("maxPerDay");
      }
      spec = { ...common, kind: "as_needed", maxPerDay };
      break;
    }
    default:
      errors.push("kind");
  }
  if (errors.length > 0 || spec === null) return { ok: false, errors };
  return { ok: true, spec };
}

/**
 * The schedule older medicines already carry: a plain list of daily times
 * (`medications.schedule_times`). Malformed entries are dropped; an empty result
 * is an as-needed schedule, so a medicine with no times never produces a slot.
 */
export function specFromLegacyTimes(times: unknown): ScheduleSpec {
  const common = { startDate: null, endDate: null, foodNote: null };
  const good = Array.isArray(times) ? [...new Set(times.filter(isValidTime))].sort() : [];
  if (good.length === 0) return { ...common, kind: "as_needed", maxPerDay: null };
  return { ...common, kind: "daily", times: good };
}

function timesOnDate(spec: ScheduleSpec, date: LocalDate): { times: string[]; doseText: string | null } {
  switch (spec.kind) {
    case "daily":
      return { times: spec.times, doseText: null };
    case "every_n_days": {
      const diff = daysBetween(spec.anchorDate, date);
      return { times: diff >= 0 && diff % spec.intervalDays === 0 ? spec.times : [], doseText: null };
    }
    case "weekdays":
      return { times: spec.days.includes(weekdayOf(date)) ? spec.times : [], doseText: null };
    case "taper": {
      // startDate is required for a taper (parse enforces it); a spec built by hand without one has no slots.
      if (spec.startDate === null) return { times: [], doseText: null };
      let offset = daysBetween(spec.startDate, date);
      for (const step of spec.steps) {
        if (offset >= 0 && offset < step.days) return { times: step.times, doseText: step.doseText };
        offset -= step.days;
      }
      return { times: [], doseText: null };
    }
    case "as_needed":
      return { times: [], doseText: null };
  }
}

/** The dose slots on one Lagos date. As-needed medicines never have slots. */
export function slotsOn(spec: ScheduleSpec, date: LocalDate): Slot[] {
  if (spec.startDate !== null && date < spec.startDate) return [];
  if (spec.endDate !== null && date > spec.endDate) return [];
  const { times, doseText } = timesOnDate(spec, date);
  return [...times].sort().map((time) => ({ date, time, doseText }));
}

/** The slots from `from` to `to`, both inclusive. Ranges over 400 days are refused. */
export function slotsBetween(spec: ScheduleSpec, from: LocalDate, to: LocalDate): Slot[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  if (span > MAX_RANGE_DAYS) throw new RangeError(`Range too long: ${span} days`);
  const out: Slot[] = [];
  for (let i = 0; i <= span; i += 1) out.push(...slotsOn(spec, addDays(from, i)));
  return out;
}

/**
 * Every clock time a schedule can ever use, sorted and de-duplicated. Older
 * readers only understand a plain list of times, so a structured schedule also
 * writes this list into `medications.schedule_times`.
 */
export function allTimes(spec: ScheduleSpec): string[] {
  if (spec.kind === "as_needed") return [];
  const times = spec.kind === "taper" ? spec.steps.flatMap((s) => s.times) : spec.times;
  return [...new Set(times)].sort();
}

export function slotKey(medicationId: string, slot: Pick<Slot, "date" | "time">): string {
  return `${medicationId}|${slot.date}|${slot.time}`;
}
