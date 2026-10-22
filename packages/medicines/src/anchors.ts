import { addDays, daysBetween, isValidLocalDate, isValidTime, type LocalDate } from "./lagos";

/**
 * Dose times anchored to the events a day is built around (S08z): waking, meals, prayer times, bedtime.
 *
 * Nothing here computes a prayer time or reads a calendar. The patient says, once, what time each anchor they
 * use is; a schedule then names an anchor and an offset ("30 minutes after breakfast"); and a "my day has
 * shifted" entry moves chosen anchors by chosen minutes for a chosen run of dates (Ramadan, a Lenten fast,
 * travel) and then simply stops applying. The schedule keeps its spec: only the resolved clock times change.
 *
 * An anchor is a scheduling convenience the patient picks. It is never advice about when to take a dose.
 *
 * The same resolution exists in SQL (`private.medication_slots_on`, with the patient's anchors read from the
 * database) for the server missed-dose job, the refill estimate and the adherence figure. The two are held
 * together by the shared cases in `anchors.fixtures.ts`.
 */
export const ANCHOR_IDS = [
  "waking",
  "morning_prayer",
  "breakfast",
  "midday_prayer",
  "lunch",
  "afternoon_prayer",
  "evening_prayer",
  "dinner",
  "night_prayer",
  "bedtime",
] as const;
export type AnchorId = (typeof ANCHOR_IDS)[number];

/** A dose is at most two hours before and three hours after its anchor. */
export const MIN_ANCHOR_OFFSET = -120;
export const MAX_ANCHOR_OFFSET = 180;
/** A shift moves one anchor by at most six hours either way. */
export const MAX_SHIFT_OFFSET = 360;

/**
 * A dose tied to a part of the patient's day, AS STORED in a medicine's schedule. It names an opaque per-patient SLOT, never the anchor
 * itself: which prayers a person ties a medicine to discloses religious belief, and a medicine's schedule is read by the care team,
 * caregivers, exports and printed reports. The slot means something only through the patient's own mapping (`AnchorProfile.slots`),
 * which only the patient and an acting guardian can read. What anyone else sees is the resolved clock time.
 */
export interface AnchoredDose {
  slot: string;
  /** Minutes after the anchor (negative: before). */
  offsetMinutes: number;
}

/** An anchored dose as the PATIENT sees it, with its slot looked up: used for plain-words display and for grouping reminders. Never stored. */
export interface ResolvedAnchor {
  anchor: AnchorId;
  offsetMinutes: number;
}

/** A slot key: "s" and ten lowercase hex digits, made by the server at random for one patient and one anchor. */
const SLOT_KEY_RE = /^s[0-9a-f]{10}$/;
export function isSlotKey(value: unknown): value is string {
  return typeof value === "string" && SLOT_KEY_RE.test(value);
}

/**
 * True when a schedule names one of the five daily prayers anywhere in it. A stored schedule must not: the database refuses it, and the
 * phone and web refuse to build one, so a prayer name can never reach a reader of a medicine.
 */
const PRAYER_NAME_RE = /(morning|midday|afternoon|evening|night)_prayer/;
export function specNamesAPrayer(spec: unknown): boolean {
  try {
    return PRAYER_NAME_RE.test(JSON.stringify(spec) ?? "");
  } catch {
    return true;
  }
}

export interface DayShift {
  /** First and last Lagos date the shift applies to, inclusive. */
  startsOn: LocalDate;
  endsOn: LocalDate;
  /**
   * Set when the patient ended the shift early: the first date it no longer applies to. Earlier dates keep their shifted
   * times, so history never moves when a shift is ended.
   */
  cancelledFrom?: LocalDate | null;
  /** Minutes to move each named anchor by on those dates. An anchor not named does not move. */
  offsets: Partial<Record<AnchorId, number>>;
}

/** A time the patient chose for an anchor, and the first Lagos date it applies to. Earlier dates keep the earlier time. */
export interface AnchorTimeVersion {
  effectiveFrom: LocalDate;
  time: string;
}

/**
 * What a patient's anchors resolve against. `defaults` are the starting times the product proposes (versioned
 * configuration, supplied by the caller: this package holds no PROPOSED value); `times` are the ones the patient
 * chose; `shifts` are their "my day has shifted" entries.
 */
export interface AnchorProfile {
  /** Which anchor each of the patient's slots stands for. Patient-private. A slot not listed here cannot be resolved. */
  slots: Readonly<Record<string, AnchorId>>;
  defaults: Record<AnchorId, string>;
  times: Partial<Record<AnchorId, readonly AnchorTimeVersion[]>>;
  shifts: readonly DayShift[];
}

export function isAnchorId(value: unknown): value is AnchorId {
  return typeof value === "string" && (ANCHOR_IDS as readonly string[]).includes(value);
}

export function isAnchorOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_ANCHOR_OFFSET && value <= MAX_ANCHOR_OFFSET;
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The time of an anchor on a date: the latest time the patient chose that had taken effect by then, else the proposed
 * default. A change the patient makes applies from its own date onward, so a day already lived (and the doses logged on
 * it) never moves. With no date, the latest chosen time (the schedule's normal look).
 */
export function anchorBaseTime(profile: AnchorProfile, anchor: AnchorId, date?: LocalDate): string {
  let chosen: string | undefined;
  let chosenFrom = "";
  for (const v of profile.times[anchor] ?? []) {
    if (!isValidTime(v.time)) continue;
    if (date !== undefined && v.effectiveFrom > date) continue;
    // The latest effective date wins, whatever order the versions arrive in.
    if (v.effectiveFrom >= chosenFrom) {
      chosen = v.time;
      chosenFrom = v.effectiveFrom;
    }
  }
  return chosen ?? profile.defaults[anchor];
}

/**
 * How far a shift moves this anchor on this date. If more than one shift covers the date, the one listed last wins
 * (the caller lists them oldest first, so the newest decision applies).
 */
export function shiftOffsetOn(profile: AnchorProfile, anchor: AnchorId, date: LocalDate): number {
  let offset = 0;
  for (const shift of profile.shifts) {
    if (date < shift.startsOn || date > shift.endsOn) continue;
    if (shift.cancelledFrom !== undefined && shift.cancelledFrom !== null && date >= shift.cancelledFrom) continue;
    const moved = shift.offsets[anchor];
    if (typeof moved === "number" && Number.isFinite(moved)) offset = Math.round(moved);
  }
  return offset;
}

export interface ResolvedDose {
  /** The Lagos date the dose lands on: the schedule's day, or the next or previous one when the resolved time crosses midnight. */
  date: LocalDate;
  /** "HH:MM", Africa/Lagos. */
  time: string;
  /** The anchor the dose's slot stands for (patient-side only). */
  anchor: AnchorId;
}

/**
 * The concrete Lagos date and time of one anchored dose on a schedule day. The anchor time, the day's shift and the dose's
 * own offset add up in minutes, so a bedtime dose an hour after a 23:30 bedtime lands at 00:30 on the NEXT date, and a
 * dose before a 00:10 waking lands at 23:xx on the PREVIOUS one, never clamped to the wrong day.
 */
export function resolveAnchoredDose(profile: AnchorProfile, dose: AnchoredDose, scheduleDate: LocalDate): ResolvedDose | null {
  const anchor = profile.slots[dose.slot];
  // A slot the patient's own mapping does not know cannot be resolved (it is never guessed).
  if (anchor === undefined) return null;
  const total = minutesOf(anchorBaseTime(profile, anchor, scheduleDate)) + shiftOffsetOn(profile, anchor, scheduleDate) + dose.offsetMinutes;
  const dayShift = Math.floor(total / 1440);
  const minuteOfDay = ((total % 1440) + 1440) % 1440;
  return { date: dayShift === 0 ? scheduleDate : addDays(scheduleDate, dayShift), time: clock(minuteOfDay), anchor };
}

/** Checks a patient's proposed day shift. Returns the reasons it is refused (empty when fine). Never throws. */
export function validateDayShift(input: unknown, maxDays: number): string[] {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) return ["shift:shape"];
  const raw = input as Record<string, unknown>;
  const starts = raw.startsOn;
  const ends = raw.endsOn;
  if (!isValidLocalDate(starts)) errors.push("startsOn:format");
  if (!isValidLocalDate(ends)) errors.push("endsOn:format");
  if (isValidLocalDate(starts) && isValidLocalDate(ends)) {
    if (ends < starts) errors.push("endsOn:before_start");
    else if (daysBetween(starts, ends) + 1 > maxDays) errors.push("range:too_long");
  }
  const offsets = raw.offsets;
  if (typeof offsets !== "object" || offsets === null || Array.isArray(offsets)) {
    errors.push("offsets:shape");
  } else {
    const entries = Object.entries(offsets as Record<string, unknown>);
    if (entries.length === 0) errors.push("offsets:empty");
    for (const [anchor, minutes] of entries) {
      if (!isAnchorId(anchor)) errors.push(`offsets.${anchor}:unknown_anchor`);
      else if (typeof minutes !== "number" || !Number.isInteger(minutes) || Math.abs(minutes) > MAX_SHIFT_OFFSET) errors.push(`offsets.${anchor}:range`);
    }
  }
  return errors;
}

/**
 * The date a changed anchor time (or a day shift) first applies. Today when nothing on the affected anchors has been answered
 * yet today; tomorrow when it has, so an answer already recorded keeps its slot. The database applies the same rule and wins.
 */
export function effectiveFromFor(today: LocalDate, hasAnswersToday: boolean): LocalDate {
  return hasAnswersToday ? addDays(today, 1) : today;
}

export type ShiftPlan =
  | { ok: true; startsOn: LocalDate; endsOn: LocalDate; offsets: Partial<Record<AnchorId, number>> }
  | { ok: false; error: "dates" | "offsets" | "not_applicable" };

/**
 * Turns what the patient entered for "my day has shifted" into what is sent: parts left at no change are dropped, the start never
 * reaches back before today, and a start today moves to tomorrow when today already has answers on the shifted anchors (the
 * database does the same). Refuses a shift with nothing to move, bad or too-long dates, or one that is already over.
 */
export function planDayShift(
  input: { startsOn: LocalDate; endsOn: LocalDate; offsets: Partial<Record<AnchorId, number>> },
  today: LocalDate,
  hasAnswersToday: boolean,
  maxDays: number
): ShiftPlan {
  const offsets: Partial<Record<AnchorId, number>> = {};
  for (const [anchor, minutes] of Object.entries(input.offsets) as [AnchorId, number][]) {
    if (typeof minutes === "number" && minutes !== 0) offsets[anchor] = minutes;
  }
  if (Object.keys(offsets).length === 0) return { ok: false, error: "offsets" };
  const problems = validateDayShift({ startsOn: input.startsOn, endsOn: input.endsOn, offsets }, maxDays);
  if (problems.some((p) => p.startsWith("offsets"))) return { ok: false, error: "offsets" };
  if (problems.length > 0) return { ok: false, error: "dates" };
  let start = input.startsOn < today ? today : input.startsOn;
  if (start === today && hasAnswersToday) start = addDays(today, 1);
  if (input.endsOn < start) return { ok: false, error: "not_applicable" };
  return { ok: true, startsOn: start, endsOn: input.endsOn, offsets };
}

/** A stored anchor time, as the database returns it. */
export interface AnchorTimeRow {
  anchor: string;
  effective_from: string;
  local_time: string;
}

/** A stored slot of the patient's, as the database returns it. */
export interface AnchorSlotRow {
  slot: string;
  anchor: string;
}

/** A stored "my day has shifted" entry, as the database returns it. */
export interface DayShiftRow {
  id: string;
  starts_on: string;
  ends_on: string;
  offsets: Record<string, number>;
  cancelled_from: string | null;
  created_at: string;
}

/**
 * Builds a profile from stored rows, ignoring any row it cannot read rather than failing (a newer server may know an anchor this
 * build does not). Shifts are listed oldest first, so the newest decision wins where two cover a date.
 */
export function buildAnchorProfile(
  defaults: Record<AnchorId, string>,
  timeRows: readonly AnchorTimeRow[],
  shiftRows: readonly DayShiftRow[],
  slotRows: readonly AnchorSlotRow[] = []
): AnchorProfile {
  const slots: Record<string, AnchorId> = {};
  for (const r of slotRows) if (isSlotKey(r.slot) && isAnchorId(r.anchor)) slots[r.slot] = r.anchor;
  const times: Partial<Record<AnchorId, AnchorTimeVersion[]>> = {};
  for (const r of timeRows) {
    if (!isAnchorId(r.anchor) || !isValidTime(r.local_time) || !isValidLocalDate(r.effective_from)) continue;
    (times[r.anchor] ??= []).push({ effectiveFrom: r.effective_from, time: r.local_time });
  }
  const shifts: DayShift[] = [...shiftRows]
    .filter((s) => isValidLocalDate(s.starts_on) && isValidLocalDate(s.ends_on) && typeof s.offsets === "object" && s.offsets !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((s) => {
      const offsets: Partial<Record<AnchorId, number>> = {};
      for (const [k, v] of Object.entries(s.offsets)) if (isAnchorId(k) && typeof v === "number" && Number.isFinite(v)) offsets[k] = v;
      return { startsOn: s.starts_on, endsOn: s.ends_on, cancelledFrom: s.cancelled_from, offsets };
    });
  return { slots, defaults, times, shifts };
}

/** The slot a patient's anchor is stored under, or undefined when they have not got one yet. */
export function slotForAnchor(profile: AnchorProfile, anchor: AnchorId): string | undefined {
  return Object.keys(profile.slots).find((slot) => profile.slots[slot] === anchor);
}
