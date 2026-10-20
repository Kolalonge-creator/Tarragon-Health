import { isAnchorId, isAnchorOffset, resolveAnchoredDose, anchorBaseTime, type AnchorId, type AnchoredDose, type AnchorProfile } from "./anchors";
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
/** The server marks a dose missed 12 hours after it is due, so a window must close well inside that. */
export const MAX_WINDOW_MINUTES = 360;

export type ParseResult = { ok: true; spec: ScheduleSpec } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanTimes(raw: unknown, errors: string[], field: string, allowEmpty = false): string[] {
  if (allowEmpty && (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0))) return [];
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

const ANCHORABLE_KINDS = ["daily", "every_n_days", "weekdays"];

function cleanAnchored(raw: unknown, errors: string[]): AnchoredDose[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TIMES_PER_DAY) {
    errors.push("anchored:count");
    return [];
  }
  const out: AnchoredDose[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const e = isRecord(entry) ? entry : {};
    if (!isAnchorId(e.anchor)) errors.push(`anchored[${i}].anchor`);
    if (!isAnchorOffset(e.offsetMinutes)) errors.push(`anchored[${i}].offsetMinutes`);
    if (isAnchorId(e.anchor) && isAnchorOffset(e.offsetMinutes)) {
      const key = `${e.anchor}|${e.offsetMinutes}`;
      if (seen.has(key)) errors.push(`anchored[${i}]:duplicate`);
      seen.add(key);
      out.push({ anchor: e.anchor, offsetMinutes: e.offsetMinutes });
    }
  });
  return out.sort((a, b) => (a.anchor === b.anchor ? a.offsetMinutes - b.offsetMinutes : a.anchor < b.anchor ? -1 : 1));
}

/**
 * Validate untrusted JSON (a database column, a form) into a ScheduleSpec. Never throws. When the patient's anchor profile is
 * given it is attached to the result (runtime only) so anchored doses resolve, and the window check counts them at their
 * resolved times.
 */
export function parseScheduleSpec(input: unknown, profile?: AnchorProfile): ParseResult {
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
  let windowMinutes = 0;
  if (input.windowMinutes !== undefined && input.windowMinutes !== null) {
    const w = input.windowMinutes;
    if (typeof w === "number" && Number.isInteger(w) && w >= 0 && w <= MAX_WINDOW_MINUTES) windowMinutes = w;
    else errors.push("windowMinutes");
  }
  const kindIsAnchorable = typeof input.kind === "string" && ANCHORABLE_KINDS.includes(input.kind);
  const anchored = cleanAnchored(input.anchored, errors);
  if (anchored.length > 0 && !kindIsAnchorable) errors.push("anchored:kind");
  const common = {
    startDate,
    endDate,
    foodNote,
    windowMinutes,
    ...(anchored.length > 0 ? { anchored } : {}),
    ...(profile ? { anchorProfile: profile } : {}),
  };
  const hasAnchored = anchored.length > 0 && kindIsAnchorable;
  const timesOf = () => cleanTimes(input.times, errors, "times", hasAnchored);

  let spec: ScheduleSpec | null = null;
  switch (input.kind) {
    case "daily":
      spec = { ...common, kind: "daily", times: timesOf() };
      break;
    case "every_n_days": {
      const n = input.intervalDays;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > MAX_INTERVAL_DAYS) errors.push("intervalDays");
      const anchorDate = optionalDate(input.anchorDate, errors, "anchorDate");
      if (anchorDate === null) errors.push("anchorDate:required");
      spec = {
        ...common,
        kind: "every_n_days",
        times: timesOf(),
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
        times: timesOf(),
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
  if (hasAnchored && spec !== null && "times" in spec && spec.times.length + anchored.length > MAX_TIMES_PER_DAY) errors.push("times:count");
  if (errors.length > 0 || spec === null) return { ok: false, errors };
  // A window must close before the next dose time: two overlapping windows leave a dose "due"
  // after the next one has started, so it could never read as unanswered at the right time.
  if (windowMinutes > 0) {
    const timeLists =
      spec.kind === "taper"
        ? spec.steps.map((s) => s.times)
        : spec.kind === "as_needed"
          ? []
          : [[...new Set([...spec.times, ...(profile ? anchoredBaseTimes(spec.anchored ?? [], profile) : [])])]];
    if (timeLists.some((times) => minGapMinutes(times) <= windowMinutes)) return { ok: false, errors: ["windowMinutes:overlap"] };
  }
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

/** The clock times anchored doses take with no shift in force: what the schedule normally looks like. */
function anchoredBaseTimes(anchored: AnchoredDose[], profile: AnchorProfile): string[] {
  return anchored.map((a) => {
    const total = minutesOf(anchorBaseTime(profile, a.anchor)) + a.offsetMinutes;
    const m = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The smallest gap between consecutive dose times in a day, counting the wrap to tomorrow's first dose. 1440 for a single time. */
function minGapMinutes(times: string[]): number {
  if (times.length < 2) return 1440;
  const sorted = times.map(minutesOf).sort((a, b) => a - b);
  let min = sorted[0] + 1440 - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i += 1) min = Math.min(min, sorted[i] - sorted[i - 1]);
  return min;
}

/** The "HH:MM" a window ends at, wrapping past midnight. */
export function windowEndTime(time: string, windowMinutes: number): string {
  const end = (minutesOf(time) + windowMinutes) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
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

/** Whether a daily, every-N-days or weekdays schedule has an occurrence on this (schedule) date, before the start and end dates. */
function occursOn(spec: ScheduleSpec, date: LocalDate): boolean {
  switch (spec.kind) {
    case "daily":
      return true;
    case "every_n_days": {
      const diff = daysBetween(spec.anchorDate, date);
      return diff >= 0 && diff % spec.intervalDays === 0;
    }
    case "weekdays":
      return spec.days.includes(weekdayOf(date));
    default:
      return false;
  }
}

function inRange(spec: ScheduleSpec, date: LocalDate): boolean {
  return !(spec.startDate !== null && date < spec.startDate) && !(spec.endDate !== null && date > spec.endDate);
}

// Times are de-duplicated before sorting, so two slots never share a time.
const byTime = (a: Slot, b: Slot): number => (a.time < b.time ? -1 : 1);

/**
 * The dose slots on one Lagos date. As-needed medicines never have slots. An anchored dose belongs to the SCHEDULE day it
 * was resolved from, so one that crosses midnight lands on the neighbouring date: this looks at the day before, the day
 * itself and the day after, and keeps what resolves onto `date`. A schedule with anchored doses and no attached anchor
 * profile resolves its anchored doses at nothing (callers always attach one).
 */
export function slotsOn(spec: ScheduleSpec, date: LocalDate): Slot[] {
  const fixed: Slot[] = [];
  if (inRange(spec, date)) {
    const { times, doseText } = timesOnDate(spec, date);
    for (const time of times) fixed.push({ date, time, doseText });
  }
  const anchored = spec.anchored;
  const profile = spec.anchorProfile;
  if (anchored === undefined || anchored.length === 0 || profile === undefined) return fixed.sort(byTime);
  const seen = new Set(fixed.map((s) => s.time));
  const out = [...fixed];
  for (const day of [addDays(date, -1), date, addDays(date, 1)]) {
    if (!inRange(spec, day) || !occursOn(spec, day)) continue;
    for (const dose of anchored) {
      const r = resolveAnchoredDose(profile, dose, day);
      if (r.date === date && !seen.has(r.time)) {
        seen.add(r.time);
        out.push({ date, time: r.time, doseText: null, anchored: dose });
      }
    }
  }
  return out.sort(byTime);
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
 * How long after its clock time a dose stays "due" before it reads as "no record yet": the
 * longer of the global missed window and the schedule's own flexible window.
 */
export function slotCloseMinutes(spec: ScheduleSpec, missedAfterMinutes: number): number {
  return Math.max(missedAfterMinutes, spec.windowMinutes ?? 0);
}

/**
 * Every clock time a schedule can ever use, sorted and de-duplicated. Older
 * readers only understand a plain list of times, so a structured schedule also
 * writes this list into `medications.schedule_times`.
 */
export function allTimes(spec: ScheduleSpec): string[] {
  if (spec.kind === "as_needed") return [];
  const times =
    spec.kind === "taper"
      ? spec.steps.flatMap((s) => s.times)
      : [...spec.times, ...(spec.anchorProfile ? anchoredBaseTimes(spec.anchored ?? [], spec.anchorProfile) : [])];
  return [...new Set(times)].sort();
}

/** The spec as it is stored: without the runtime anchor profile. */
export function toStoredSpec(spec: ScheduleSpec): ScheduleSpec {
  const stored = { ...spec };
  delete stored.anchorProfile;
  return stored;
}

export function slotKey(medicationId: string, slot: Pick<Slot, "date" | "time">): string {
  return `${medicationId}|${slot.date}|${slot.time}`;
}

/**
 * Which medicines would have a flexible window overlap the next dose if this anchor were moved to `time` (S08z). Only schedules
 * with anchored doses and a window can conflict. Returns their ids; empty means the change is safe. The database refuses the
 * same change (a trigger on patient_dose_anchors), so this is what lets the phone say why before it tries.
 */
export function anchorChangeConflicts(
  medicines: readonly { id: string; spec: ScheduleSpec }[],
  profile: AnchorProfile,
  anchor: AnchorId,
  time: string,
): string[] {
  const moved: AnchorProfile = { ...profile, times: { ...profile.times, [anchor]: [{ effectiveFrom: "9999-12-31", time }] } };
  const out: string[] = [];
  for (const { id, spec } of medicines) {
    if (spec.kind === "taper" || spec.kind === "as_needed") continue;
    const window = spec.windowMinutes ?? 0;
    const anchored = spec.anchored ?? [];
    if (window <= 0 || anchored.length === 0) continue;
    const times = [...new Set([...spec.times, ...anchoredBaseTimes(anchored, moved)])];
    if (minGapMinutes(times) <= window) out.push(id);
  }
  return out;
}
