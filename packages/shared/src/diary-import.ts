/**
 * Paper diary import (S07y): the pure half. A person copies readings from their own handwritten diary into the app, either by typing rows (works with no
 * model at all) or by checking rows a reading assistant SUGGESTED from a photo of the page (AI-021, off by default).
 *
 * THE RULES THIS FILE KEEPS (each has a test):
 *  - A suggestion is not a reading. The assistant's output is turned into editable DRAFT rows that start unconfirmed; only a row the person has confirmed is
 *    ever turned into a reading, and `confirmedRowsToReadings` refuses to build one from anything else.
 *  - This file decides NOTHING clinical. Whether a number is dangerous is the deterministic triage in the database and on the phone; whether it is impossible
 *    is the existing `devices.plausibility` configuration through `classifyPlausibility`. No threshold is added here and no model is consulted (INV-01).
 *  - A diary reading is dated inside a bounded window (`vitals.diary_import.window_days`, mirrored by offline_sync_config.diary_window_days) and is REFUSED
 *    outside it or with no date. The server refuses it too; this module says so first, in words, so the person can fix the row (explain, do not just refuse).
 *  - Lagos is UTC+1 all year, so a date and a time read off a page are turned into an instant without any clock or zone database.
 */
import { z } from "zod";
import { classifyPlausibility } from "./device-plausibility";
import { getProposedConfig } from "./proposed-config";

export type DiaryKind = "blood_pressure" | "glucose";
export type DiaryGlucoseUnit = "mmol_l" | "mg_dl";
export const DIARY_GLUCOSE_CONTEXTS = ["fasting", "pre_meal", "post_meal", "bedtime", "night", "random"] as const;
export type DiaryGlucoseContext = (typeof DIARY_GLUCOSE_CONTEXTS)[number];

const MG_DL_PER_MMOL = 18.0182;

export interface DiaryLimits {
  windowDays: number;
  skewMinutes: number;
  maxRows: number;
  maxPhotoBytes: number;
  /** How many photos one person may send for reading in an hour (each is a paid model call). */
  maxReadsPerHour: number;
  /** Version of vitals.diary_import used (INV-16). */
  configVersion: number;
}

export function diaryLimits(asOf?: string): DiaryLimits {
  const entry = getProposedConfig<{ window_days: number; future_skew_minutes: number; max_rows_per_save: number; max_photo_bytes: number; max_reads_per_hour: number }>("vitals.diary_import", asOf);
  return {
    windowDays: entry.value.window_days,
    skewMinutes: entry.value.future_skew_minutes,
    maxRows: entry.value.max_rows_per_save,
    maxPhotoBytes: entry.value.max_photo_bytes,
    maxReadsPerHour: entry.value.max_reads_per_hour,
    configVersion: entry.version,
  };
}

/** One row of the sheet, exactly as the person sees it: every field is the text in the box. */
export interface DiaryDraftRow {
  /** A stable id for the row inside the sheet, also the idempotency key of what is saved from it (a retry never doubles a reading). */
  key: string;
  kind: DiaryKind;
  /** YYYY-MM-DD, the day written on the diary page (Lagos). */
  date: string;
  /** HH:MM, 24-hour (Lagos). */
  time: string;
  systolic: string;
  diastolic: string;
  /** Blood pressure rows only, optional. */
  pulse: string;
  glucose: string;
  glucoseUnit: DiaryGlucoseUnit | "";
  glucoseContext: DiaryGlucoseContext | "";
  /** True when the assistant suggested this row. A suggested row starts UNCONFIRMED. */
  suggested: boolean;
  /** The person has checked this row against the diary and it matches. Editing any box clears it again. */
  confirmed: boolean;
}

export function emptyDiaryRow(key: string, kind: DiaryKind = "blood_pressure", defaults: Partial<DiaryDraftRow> = {}): DiaryDraftRow {
  return {
    key,
    kind,
    date: "",
    time: "",
    systolic: "",
    diastolic: "",
    pulse: "",
    glucose: "",
    glucoseUnit: "",
    glucoseContext: "",
    suggested: false,
    // a row the person types is theirs the moment they save; only a suggestion needs a separate "this matches my diary"
    confirmed: true,
    ...defaults,
  };
}

/** Everything that can be wrong with a row. Each has plain words under `diary.problem.<code>` in packages/i18n. */
export const DIARY_PROBLEMS = [
  "date_missing",
  "date_invalid",
  "date_future",
  "date_too_old",
  "time_missing",
  "time_invalid",
  "systolic_missing",
  "diastolic_missing",
  "pulse_not_number",
  "glucose_missing",
  "glucose_unit_missing",
  "glucose_context_missing",
  "not_confirmed",
  "systolic_range",
  "diastolic_range",
  "systolic_not_above_diastolic",
  "pulse_range",
  "glucose_range",
] as const;
export type DiaryProblem = (typeof DIARY_PROBLEMS)[number];

export interface DiaryReading {
  key: string;
  vitalType: DiaryKind;
  /** The instant the person says it was taken (ISO, UTC). The server keeps it only inside the window. */
  takenAt: string;
  systolic?: number;
  diastolic?: number;
  pulseBpm?: number;
  glucoseMmolL?: number;
  glucoseContext?: DiaryGlucoseContext;
}

export type DiaryValidation = { ok: true; reading: DiaryReading } | { ok: false; problems: DiaryProblem[] };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INT_RE = /^\d{1,3}$/;
const DEC_RE = /^\d{1,3}(?:[.,]\d{1,2})?$/;

/** The instant for a Lagos date and time, or null when either is not a real one. */
export function diaryLagosInstant(date: string, time: string): number | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null;
  return Date.UTC(y, mo - 1, da, Number(t[1]) - 1, Number(t[2]));
}

/** Today's date in Lagos as YYYY-MM-DD. */
export function diaryTodayLagos(nowMs: number): string {
  return new Date(nowMs + 3_600_000).toISOString().slice(0, 10);
}

function num(text: string, re: RegExp): number | null {
  const s = text.trim();
  if (!re.test(s)) return null;
  return Number(s.replace(",", "."));
}

/**
 * One row to either a reading or the list of things to fix. A suggested row that is not confirmed is never a reading. Impossible values come back as
 * problems the person can read and correct; they are never saved and never silently altered.
 */
export function validateDiaryRow(row: DiaryDraftRow, nowMs: number, limits: DiaryLimits = diaryLimits(), ageYears?: number | null): DiaryValidation {
  const problems: DiaryProblem[] = [];
  if (!row.confirmed) problems.push("not_confirmed");

  let at: number | null = null;
  if (row.date.trim() === "") problems.push("date_missing");
  else if (!DATE_RE.test(row.date)) problems.push("date_invalid");
  if (row.time.trim() === "") problems.push("time_missing");
  else if (!TIME_RE.test(row.time)) problems.push("time_invalid");
  if (!problems.some((p) => p.startsWith("date_") || p.startsWith("time_"))) {
    at = diaryLagosInstant(row.date, row.time);
    if (at === null) problems.push("date_invalid");
    else if (at > nowMs + limits.skewMinutes * 60_000) problems.push("date_future");
    else if (at < nowMs - limits.windowDays * 86_400_000) problems.push("date_too_old");
  }

  let reading: DiaryReading | null = null;
  if (row.kind === "blood_pressure") {
    const sys = row.systolic.trim() === "" ? null : num(row.systolic, INT_RE);
    const dia = row.diastolic.trim() === "" ? null : num(row.diastolic, INT_RE);
    if (row.systolic.trim() === "" || sys === null) problems.push("systolic_missing");
    if (row.diastolic.trim() === "" || dia === null) problems.push("diastolic_missing");
    let pulse: number | null = null;
    if (row.pulse.trim() !== "") {
      pulse = num(row.pulse, INT_RE);
      if (pulse === null) problems.push("pulse_not_number");
    }
    if (sys !== null && dia !== null) {
      const check = classifyPlausibility({ vitalType: "blood_pressure", systolic: sys, diastolic: dia, pulseBpm: pulse, ageYears: ageYears ?? null });
      for (const reason of check.reasons) problems.push(reason as DiaryProblem);
      reading = { key: row.key, vitalType: "blood_pressure", takenAt: "", systolic: sys, diastolic: dia, ...(pulse !== null ? { pulseBpm: pulse } : {}) };
    }
  } else {
    const g = row.glucose.trim() === "" ? null : num(row.glucose, DEC_RE);
    if (g === null) problems.push("glucose_missing");
    if (row.glucoseUnit === "") problems.push("glucose_unit_missing");
    if (row.glucoseContext === "") problems.push("glucose_context_missing");
    if (g !== null && row.glucoseUnit !== "") {
      const mmol = row.glucoseUnit === "mg_dl" ? Math.round((g / MG_DL_PER_MMOL) * 100) / 100 : g;
      const check = classifyPlausibility({ vitalType: "glucose", glucoseMmolL: mmol });
      for (const reason of check.reasons) problems.push(reason as DiaryProblem);
      if (row.glucoseContext !== "") reading = { key: row.key, vitalType: "glucose", takenAt: "", glucoseMmolL: mmol, glucoseContext: row.glucoseContext };
    }
  }

  // de-duplicate (a swapped or missing digit can trip two reasons) while keeping order
  const unique = [...new Set(problems)];
  if (unique.length > 0 || reading === null || at === null) return { ok: false, problems: unique.length > 0 ? unique : ["date_invalid"] };
  return { ok: true, reading: { ...reading, takenAt: new Date(at).toISOString() } };
}

export interface DiarySheetResult {
  readings: DiaryReading[];
  /** Rows that are not ready, with the reasons, so the sheet can show them beside the row. A row the person has not confirmed is listed here too. */
  blocked: { key: string; problems: DiaryProblem[] }[];
  /** True when more rows were given than one save may carry. Nothing is sent in that case. */
  tooMany: boolean;
}

/**
 * The only way rows become readings. A row is included only when it is confirmed and valid; the sheet is refused whole when it is longer than one save may
 * carry, so no row is ever silently dropped.
 */
export function confirmedRowsToReadings(rows: readonly DiaryDraftRow[], nowMs: number, limits: DiaryLimits = diaryLimits(), ageYears?: number | null): DiarySheetResult {
  if (rows.length > limits.maxRows) return { readings: [], blocked: [], tooMany: true };
  const readings: DiaryReading[] = [];
  const blocked: { key: string; problems: DiaryProblem[] }[] = [];
  for (const row of rows) {
    const v = validateDiaryRow(row, nowMs, limits, ageYears);
    if (v.ok) readings.push(v.reading);
    else blocked.push({ key: row.key, problems: v.problems });
  }
  return { readings, blocked, tooMany: false };
}

// ---------- the reading assistant's output --------------------------------------------------------------------------------------------------

/** What the assistant is asked to return: text as written on the page, never interpreted. */
export const rawDiaryPageSchema = z.object({
  rows: z.array(
    z.object({
      kind: z.enum(["blood_pressure", "glucose"]),
      /** The date as written (for example "12/10/2026", "12 Oct"). */
      date_text: z.string().nullable(),
      /** The time as written (for example "8am", "20:15"), or the words written beside the reading ("morning", "evening"). */
      time_text: z.string().nullable(),
      systolic_text: z.string().nullable(),
      diastolic_text: z.string().nullable(),
      pulse_text: z.string().nullable(),
      glucose_text: z.string().nullable(),
      /** The unit only if the page itself shows it. */
      glucose_unit: z.enum(["mmol_l", "mg_dl"]).nullable(),
      /** Words written beside a glucose reading (for example "fasting", "after lunch"), or null. */
      glucose_context_text: z.string().nullable(),
    })
  ),
  /** Set when the image is too poor, cropped, or not a diary at all. */
  unreadable_reason: z.string().nullable(),
});
export type RawDiaryPage = z.infer<typeof rawDiaryPageSchema>;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date as written on a Nigerian diary: day first. Returns YYYY-MM-DD or "" when it cannot be read with confidence. A date with no year takes this year,
 * or last year when that would put it in the future. A two-digit year is the 2000s.
 */
export function parseDiaryDate(text: string | null | undefined, todayLagosDate: string): string {
  if (!text) return "";
  const t = text.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const today = DATE_RE.exec(todayLagosDate);
  if (!today) return "";
  const thisYear = Number(today[1]);
  let d: number | null = null;
  let m: number | null = null;
  let y: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?$/.exec(t))) {
    d = Number(match[1]); m = Number(match[2]);
    if (match[3]) y = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  } else if ((match = /^(\d{1,2})\s*([a-z]{3,})\.?(?:,?\s*(\d{2}|\d{4}))?$/.exec(t))) {
    d = Number(match[1]); m = MONTHS[(match[2] ?? "").slice(0, 3)] ?? null;
    if (match[3]) y = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  }
  if (d === null || m === null || m < 1 || m > 12 || d < 1 || d > 31) return "";
  let year = y ?? thisYear;
  let candidate = `${year}-${pad(m)}-${pad(d)}`;
  if (diaryLagosInstant(candidate, "12:00") === null) return "";
  if (y === null && candidate > todayLagosDate) {
    year -= 1;
    candidate = `${year}-${pad(m)}-${pad(d)}`;
    if (diaryLagosInstant(candidate, "12:00") === null) return "";
  }
  return candidate;
}

/**
 * A time as written: "8am", "8.30 pm", "20:15". Returns HH:MM or "" when it is not an UNAMBIGUOUS clock time. A time with no am or pm is accepted only when
 * it can only be a 24-hour time (13:00 to 23:59, or 00:xx); "8:30", "08:30" and "0830" could be morning or evening, and a guess would be a made-up reading
 * time that moves the reading by twelve hours, so they are left empty for the person to fill (the words "morning" and "evening" are not guessed either).
 */
export function parseDiaryTime(text: string | null | undefined): string {
  if (!text) return "";
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return "";
  if (m[3] === undefined) {
    // no am or pm: only an hour that cannot be read two ways is accepted, and only with its minutes
    if (m[2] === undefined) return "";
    if (h > 23) return "";
    if (h >= 1 && h <= 12) return "";
    return `${pad(h)}:${pad(min)}`;
  }
  if (h < 1 || h > 12) return "";
  if (m[3] === "am") {
    if (h === 12) h = 0;
  } else if (h !== 12) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

function digits(text: string | null | undefined, int: boolean): string {
  if (!text) return "";
  const s = text.trim().replace(/\s+/g, "");
  return (int ? INT_RE : DEC_RE).test(s) ? s.replace(",", ".") : "";
}

export function parseGlucoseContext(text: string | null | undefined): DiaryGlucoseContext | "" {
  if (!text) return "";
  const t = text.toLowerCase();
  const after = /\b(after|post)\b|\b2\s*h\b|\bpp\b|\bpc\b/.test(t);
  const fasting = /\bfast(ing)?\b|\bfbs\b|\bfbg\b|before\s*break/.test(t);
  // both ("fasting, then after a meal") is ambiguous: left for the person, never guessed. Note "breakfast" is not "fast": a word, not a substring.
  if (after && fasting) return "";
  if (after) return "post_meal";
  if (/bed\s*time|before\s*bed|\bhs\b/.test(t)) return "bedtime";
  if (fasting) return "fasting";
  if (/\bbefore\b|\bpre\b|\bac\b/.test(t)) return "pre_meal";
  if (/night|3\s*am/.test(t)) return "night";
  if (/random|rbs/.test(t)) return "random";
  return "";
}

/**
 * The assistant's output to editable draft rows. Every row starts UNCONFIRMED (a suggestion is never the record), the page's own text is turned into
 * values only where it can be read with confidence and otherwise left empty for the person to fill, and no more rows than one save may carry are
 * returned (the rest are counted, never silently dropped).
 */
export function draftRowsFromSuggestions(
  raw: RawDiaryPage,
  todayLagosDate: string,
  newKey: () => string,
  limits: DiaryLimits = diaryLimits(),
): { rows: DiaryDraftRow[]; skipped: number; unreadableReason: string | null } {
  const rows: DiaryDraftRow[] = [];
  let skipped = 0;
  for (const r of raw.rows) {
    if (rows.length >= limits.maxRows) {
      skipped += 1;
      continue;
    }
    rows.push({
      key: newKey(),
      kind: r.kind,
      date: parseDiaryDate(r.date_text, todayLagosDate),
      time: parseDiaryTime(r.time_text),
      systolic: r.kind === "blood_pressure" ? digits(r.systolic_text, true) : "",
      diastolic: r.kind === "blood_pressure" ? digits(r.diastolic_text, true) : "",
      pulse: r.kind === "blood_pressure" ? digits(r.pulse_text, true) : "",
      glucose: r.kind === "glucose" ? digits(r.glucose_text, false) : "",
      glucoseUnit: r.kind === "glucose" ? (r.glucose_unit ?? "") : "",
      glucoseContext: r.kind === "glucose" ? parseGlucoseContext(r.glucose_context_text) : "",
      suggested: true,
      confirmed: false,
    });
  }
  return { rows, skipped, unreadableReason: raw.unreadable_reason };
}
