/**
 * S07x: the seven-day home blood pressure check. Pure, deterministic and free of any clock, network or model (INV-01): `nowMs` is an input.
 *
 * Every number comes from the versioned configuration (`bp.home_programme`, mirrored by the database row `home_bp_programme_signoffs`), never from
 * this file. The text the numbers implement was approved by the Chief Medical Officer on 2026-10-07 (C1, C2, C3) and is NOT signed until the
 * database row is signed (INV-14, INV-16).
 *
 * What it does, and the limits that matter:
 *  - C1 protocol: 2 readings a minute apart, morning and evening, for a target of 7 days. The average counts EVERY reading in the window
 *    (S11 decision: no reading is dropped, except a second save of the same measurement taken less than `minGapMinutes` after the one before).
 *    A "complete" average exists only at `minReadings` readings over `minDays` days; below that there is no average at all ("not enough readings yet").
 *  - C2 bands: the band is a description of a complete average, never a grade of a single reading (single readings stay with the S11/S12 rule set).
 *    The words are "above your target range", never "uncontrolled".
 *  - C3 pattern: clinician-only. Returns a kind for a routine clinician task. It never reaches a patient, a notification (INV-07) or a medicine (INV-02).
 *
 * The same rules are written in SQL (`private.home_bp_assess`, `private.bp_pattern_kind`) because the server must not trust a number sent by a phone.
 * `fixtures/home-bp-parity.json` is run through both, so the two cannot drift.
 */
import { lagosDateKey } from "./dates";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** Africa/Lagos is UTC+1 with no daylight saving. */
const LAGOS_OFFSET_MS = 3_600_000;

export interface HomeBpConfig {
  readonly version: number;
  readonly protocol: {
    readonly readingsPerSession: number;
    readonly minGapMinutes: number;
    readonly targetDays: number;
    readonly minDays: number;
    readonly minReadings: number;
    readonly restMinutes: number;
    readonly avoidBeforeMinutes: number;
    /** Lagos hour range [start, end), end 24 meaning midnight. */
    readonly morningHours: readonly [number, number];
    readonly eveningHours: readonly [number, number];
  };
  readonly bands: {
    readonly aboveSystolic: number;
    readonly aboveDiastolic: number;
    readonly borderlineSystolic: number;
    readonly borderlineDiastolic: number;
  };
  readonly pattern: {
    readonly clinicSystolic: number;
    readonly clinicDiastolic: number;
    readonly windowDays: number;
  };
  readonly tasks: { readonly reviewDueMinutes: number; readonly patternDueMinutes: number };
}

export interface HomeBpReading {
  readonly systolic: number;
  readonly diastolic: number;
  /** UTC milliseconds of the reading (the server's `taken_at`, or the phone's resolved effective time). */
  readonly atMs: number;
}

export type SessionPart = "morning" | "evening";
export type HomeBand = "above_home_level" | "borderline" | "within_home_target";

export interface ScheduledSession {
  readonly date: string;
  readonly part: SessionPart;
}

/** `YYYY-MM-DD` plus whole days, on the calendar (no timezone involved). */
export function addLocalDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Lagos hour (0 to 23) of an instant. */
function lagosHourOf(ms: number): number {
  return new Date(ms + LAGOS_OFFSET_MS).getUTCHours();
}

/** Which session an instant belongs to, or null when it is outside both windows (a reading is still counted, it just does not fill a session). */
export function sessionPartOf(atMs: number, cfg: HomeBpConfig): SessionPart | null {
  const h = lagosHourOf(atMs);
  const { morningHours, eveningHours } = cfg.protocol;
  if (h >= morningHours[0] && h < morningHours[1]) return "morning";
  if (h >= eveningHours[0] && h < eveningHours[1]) return "evening";
  return null;
}

/** Every session the protocol asks for, in order: morning then evening for each of `targetDays` days starting on `startDate`. */
export function homeCheckSchedule(startDate: string, cfg: HomeBpConfig): ScheduledSession[] {
  const out: ScheduledSession[] = [];
  for (let i = 0; i < cfg.protocol.targetDays; i += 1) {
    const date = addLocalDays(startDate, i);
    out.push({ date, part: "morning" }, { date, part: "evening" });
  }
  return out;
}

/**
 * A reading taken less than `minGapMinutes` after the one before it is the same measurement saved twice or retyped, so it is not counted.
 * Input need not be sorted; output is oldest first.
 */
export function dedupeReadings(readings: readonly HomeBpReading[], cfg: HomeBpConfig): HomeBpReading[] {
  // Ties on the instant are broken by the values so the same readings always give the same result (the database sorts the same way).
  const sorted = [...readings].sort((a, b) => a.atMs - b.atMs || a.systolic - b.systolic || a.diastolic - b.diastolic);
  const gapMs = cfg.protocol.minGapMinutes * MIN_MS;
  const kept: HomeBpReading[] = [];
  let previousAt: number | null = null;
  for (const r of sorted) {
    if (previousAt === null || r.atMs - previousAt >= gapMs) kept.push(r);
    previousAt = r.atMs;
  }
  return kept;
}

export interface SessionProgress {
  readonly date: string;
  readonly part: SessionPart;
  readonly readings: number;
  /** True when the session holds `readingsPerSession` readings. */
  readonly done: boolean;
}

/** Group counted readings into the scheduled sessions and say which sessions are complete. Readings outside every session window fill none. */
export function pairSessions(readings: readonly HomeBpReading[], startDate: string, cfg: HomeBpConfig): SessionProgress[] {
  const counts = new Map<string, number>();
  for (const r of readings) {
    const part = sessionPartOf(r.atMs, cfg);
    if (part === null) continue;
    const key = `${lagosDateKey(r.atMs)}|${part}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return homeCheckSchedule(startDate, cfg).map((s) => {
    const n = counts.get(`${s.date}|${s.part}`) ?? 0;
    return { date: s.date, part: s.part, readings: n, done: n >= cfg.protocol.readingsPerSession };
  });
}

/** The band for a complete average (C2). `>=` on either number: 135 over 85 or above is above the home hypertension level. */
export function bandHomeMean(systolic: number, diastolic: number, cfg: HomeBpConfig): HomeBand {
  const b = cfg.bands;
  if (systolic >= b.aboveSystolic || diastolic >= b.aboveDiastolic) return "above_home_level";
  if (systolic >= b.borderlineSystolic || diastolic >= b.borderlineDiastolic) return "borderline";
  return "within_home_target";
}

export interface PersonalTarget {
  readonly systolic: number;
  readonly diastolic: number;
  /** True only when a clinician has set it (who and when recorded); otherwise it is a "starting suggestion, not yet confirmed". */
  readonly confirmed: boolean;
}

export interface TargetStatus {
  readonly status: "above_target" | "within_target";
  readonly confirmed: boolean;
}

/** Compare a complete average with the personal target of a treated patient. Wording is "above your target range", never "uncontrolled". */
export function statusAgainstTarget(systolic: number, diastolic: number, target: PersonalTarget): TargetStatus {
  const above = systolic >= target.systolic || diastolic >= target.diastolic;
  return { status: above ? "above_target" : "within_target", confirmed: target.confirmed };
}

export interface HomeCheckInput {
  readonly readings: readonly HomeBpReading[];
  /** The Lagos date the patient started the check (YYYY-MM-DD). */
  readonly startDate: string;
  readonly nowMs: number;
}

export interface HomeCheckAssessment {
  readonly windowStart: string;
  readonly windowEnd: string;
  /** 1-based day of the protocol that today is, never above `targetDays`. */
  readonly dayNumber: number;
  /** The protocol window has passed. */
  readonly windowOver: boolean;
  /** Counted readings inside the window. */
  readings: number;
  /** Days with at least one counted reading. */
  days: number;
  sessionsDone: number;
  sessionsExpected: number;
  /** True at `minReadings` readings over `minDays` days. Only then does an average exist. */
  complete: boolean;
  /** Null until complete ("not enough readings yet"). Whole numbers, every counted reading averaged. */
  mean: { systolic: number; diastolic: number } | null;
  band: HomeBand | null;
  /** What is still missing, null when complete. */
  shortfall: { moreReadings: number; moreDays: number } | null;
  /** Today's two sessions, so the card can say what to do now. */
  today: readonly SessionProgress[];
}

const meanOf = (values: readonly number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

export function assessHomeCheck(input: HomeCheckInput, cfg: HomeBpConfig): HomeCheckAssessment {
  const { startDate, nowMs } = input;
  const windowEnd = addLocalDays(startDate, cfg.protocol.targetDays - 1);
  const today = lagosDateKey(nowMs);
  const inWindow = input.readings.filter((r) => {
    const d = lagosDateKey(r.atMs);
    return d >= startDate && d <= windowEnd;
  });
  const counted = dedupeReadings(inWindow, cfg);
  const sessions = pairSessions(counted, startDate, cfg);
  const days = new Set(counted.map((r) => lagosDateKey(r.atMs))).size;
  const complete = counted.length >= cfg.protocol.minReadings && days >= cfg.protocol.minDays;
  const mean = complete
    ? { systolic: meanOf(counted.map((r) => r.systolic)), diastolic: meanOf(counted.map((r) => r.diastolic)) }
    : null;
  const daysSinceStart = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS);
  return {
    windowStart: startDate,
    windowEnd,
    dayNumber: Math.min(Math.max(daysSinceStart + 1, 1), cfg.protocol.targetDays),
    windowOver: today > windowEnd,
    readings: counted.length,
    days,
    sessionsDone: sessions.filter((s) => s.done).length,
    sessionsExpected: sessions.length,
    complete,
    mean,
    band: mean ? bandHomeMean(mean.systolic, mean.diastolic, cfg) : null,
    shortfall: complete
      ? null
      : {
          moreReadings: Math.max(0, cfg.protocol.minReadings - counted.length),
          moreDays: Math.max(0, cfg.protocol.minDays - days),
        },
    today: sessions.filter((s) => s.date === today),
  };
}

export type PatternKind = "masked" | "masked_uncontrolled" | "white_coat";

export interface PatternInput {
  readonly clinic: { readonly systolic: number; readonly diastolic: number; readonly atMs: number };
  /** A COMPLETE protocol average; the caller must not pass an incomplete one. */
  readonly home: { readonly systolic: number; readonly diastolic: number; readonly endMs: number };
  /** Taking blood pressure medicines now. */
  readonly treated: boolean;
  /** Pregnancy has its own lines; the pattern rule does not apply. */
  readonly pregnant: boolean;
  /** Null when the date of birth is not known; an unknown age is still evaluated (a missed pattern costs more than a routine task). */
  readonly ageYears: number | null;
}

/**
 * C3, clinician-only. Masked = clinic below 140/90 and home 135/85 or above (called "masked uncontrolled" for a treated patient).
 * White-coat = clinic 140/90 or above and home below 135/85, untreated only. The clinic reading and the home average must be within `windowDays`.
 * The result is a reason for one routine "pattern for review" task. It is never a diagnosis, never shown to the patient and never changes a medicine.
 */
export function detectBpPattern(input: PatternInput, cfg: HomeBpConfig): PatternKind | null {
  if (input.pregnant) return null;
  if (input.ageYears !== null && input.ageYears < 18) return null;
  if (Math.abs(input.clinic.atMs - input.home.endMs) > cfg.pattern.windowDays * DAY_MS) return null;
  const clinicRaised = input.clinic.systolic >= cfg.pattern.clinicSystolic || input.clinic.diastolic >= cfg.pattern.clinicDiastolic;
  const homeAbove = input.home.systolic >= cfg.bands.aboveSystolic || input.home.diastolic >= cfg.bands.aboveDiastolic;
  if (!clinicRaised && homeAbove) return input.treated ? "masked_uncontrolled" : "masked";
  if (clinicRaised && !homeAbove && !input.treated) return "white_coat";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Loading the configuration. A malformed value is refused loudly, never half-applied.
// ---------------------------------------------------------------------------------------------------------------------------------
type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function section(raw: Raw, name: string): Raw {
  const v = raw[name];
  if (!isRecord(v)) throw new Error(`home BP config: ${name} must be an object`);
  return v;
}

function whole(raw: Raw, name: string, field: string, min: number): number {
  const v = raw[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Error(`home BP config: ${name}.${field} must be a whole number of at least ${min}`);
  return v;
}

function hourRange(raw: Raw, field: string): readonly [number, number] {
  const v = raw[field];
  if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1]) || v[0] < 0 || v[1] > 24 || v[0] >= v[1]) {
    throw new Error(`home BP config: protocol.${field} must be [startHour, endHour) within 0 to 24`);
  }
  return [v[0], v[1]];
}

/** Turn the stored value (registry entry or signed database row) into a typed, checked configuration. */
export function parseHomeBpConfig(version: number, value: unknown): HomeBpConfig {
  if (!isRecord(value)) throw new Error("home BP config must be an object");
  const p = section(value, "protocol");
  const b = section(value, "bands");
  const pt = section(value, "pattern");
  const t = section(value, "tasks");
  const cfg: HomeBpConfig = {
    version,
    protocol: {
      readingsPerSession: whole(p, "protocol", "readingsPerSession", 1),
      minGapMinutes: whole(p, "protocol", "minGapMinutes", 0),
      targetDays: whole(p, "protocol", "targetDays", 1),
      minDays: whole(p, "protocol", "minDays", 1),
      minReadings: whole(p, "protocol", "minReadings", 1),
      restMinutes: whole(p, "protocol", "restMinutes", 0),
      avoidBeforeMinutes: whole(p, "protocol", "avoidBeforeMinutes", 0),
      morningHours: hourRange(p, "morningHours"),
      eveningHours: hourRange(p, "eveningHours"),
    },
    bands: {
      aboveSystolic: whole(b, "bands", "aboveSystolic", 1),
      aboveDiastolic: whole(b, "bands", "aboveDiastolic", 1),
      borderlineSystolic: whole(b, "bands", "borderlineSystolic", 1),
      borderlineDiastolic: whole(b, "bands", "borderlineDiastolic", 1),
    },
    pattern: {
      clinicSystolic: whole(pt, "pattern", "clinicSystolic", 1),
      clinicDiastolic: whole(pt, "pattern", "clinicDiastolic", 1),
      windowDays: whole(pt, "pattern", "windowDays", 1),
    },
    tasks: {
      reviewDueMinutes: whole(t, "tasks", "reviewDueMinutes", 1),
      patternDueMinutes: whole(t, "tasks", "patternDueMinutes", 1),
    },
  };
  if (cfg.protocol.minDays > cfg.protocol.targetDays) throw new Error("home BP config: protocol.minDays cannot exceed protocol.targetDays");
  if (cfg.bands.borderlineSystolic > cfg.bands.aboveSystolic || cfg.bands.borderlineDiastolic > cfg.bands.aboveDiastolic) {
    throw new Error("home BP config: the borderline band cannot start above the home hypertension level");
  }
  return cfg;
}
