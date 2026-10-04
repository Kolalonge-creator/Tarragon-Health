import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QuietHours } from "./reminder-schedule";
import type { BpReminder, ReminderPrefs } from "./reminder-plan";

/**
 * The patient's reminder settings (S07 reminders): validation, edits, and saving
 * on the phone per account. The settings are small and are not clinical records,
 * so they live in AsyncStorage rather than the offline database. They are never
 * sent anywhere.
 *
 * Everything the patient types goes through here, so the planner can trust what
 * it reads. A saved value that is missing, corrupt or from a future version falls
 * back to the defaults instead of throwing.
 */
export const MAX_BP_REMINDERS = 6;
export const MAX_TIMES_PER_REMINDER = 4;

/**
 * Medicine reminders default to ON because the app already reminded patients of
 * their doses before this screen existed; turning them off by default would
 * silently remove a safety net. Quiet hours default to none.
 */
export const DEFAULT_PREFS: ReminderPrefs = { version: 1, bp: [], doseOn: true, quiet: null };

export type DraftError = "no_times" | "bad_time" | "too_many_times" | "no_days" | "bad_days" | "too_many_reminders";

export interface BpDraft {
  times: readonly string[];
  /** 0 = Sunday ... 6 = Saturday. */
  days: readonly number[];
}

/** "8:5" is not a time; "8:05" and "08:05" are. Returns the zero-padded HH:MM, or null. */
export function normaliseTime(value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Checks a reminder the patient is editing and returns it in stored form (sorted, no duplicates, all seven days become "every day"). */
export function normaliseDraft(draft: BpDraft): { ok: true; times: string[]; days: number[] | null } | { ok: false; error: DraftError } {
  if (draft.times.length === 0) return { ok: false, error: "no_times" };
  const times: string[] = [];
  for (const raw of draft.times) {
    const t = normaliseTime(raw);
    if (t === null) return { ok: false, error: "bad_time" };
    if (!times.includes(t)) times.push(t);
  }
  if (times.length > MAX_TIMES_PER_REMINDER) return { ok: false, error: "too_many_times" };
  if (draft.days.length === 0) return { ok: false, error: "no_days" };
  if (draft.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, error: "bad_days" };
  const days = [...new Set(draft.days)].sort((a, b) => a - b);
  return { ok: true, times: times.sort(), days: days.length === 7 ? null : days };
}

export type EditResult = { ok: true; prefs: ReminderPrefs } | { ok: false; error: DraftError };

export function addBpReminder(prefs: ReminderPrefs, draft: BpDraft, id: string): EditResult {
  if (prefs.bp.length >= MAX_BP_REMINDERS) return { ok: false, error: "too_many_reminders" };
  const n = normaliseDraft(draft);
  if (!n.ok) return n;
  return { ok: true, prefs: { ...prefs, bp: [...prefs.bp, { id, times: n.times, days: n.days, active: true }] } };
}

export function updateBpReminder(prefs: ReminderPrefs, id: string, draft: BpDraft): EditResult {
  const n = normaliseDraft(draft);
  if (!n.ok) return n;
  return {
    ok: true,
    prefs: { ...prefs, bp: prefs.bp.map((r) => (r.id === id ? { ...r, times: n.times, days: n.days } : r)) },
  };
}

export function removeBpReminder(prefs: ReminderPrefs, id: string): ReminderPrefs {
  return { ...prefs, bp: prefs.bp.filter((r) => r.id !== id) };
}

export function setBpActive(prefs: ReminderPrefs, id: string, active: boolean): ReminderPrefs {
  return { ...prefs, bp: prefs.bp.map((r) => (r.id === id ? { ...r, active } : r)) };
}

export function setDoseOn(prefs: ReminderPrefs, doseOn: boolean): ReminderPrefs {
  return { ...prefs, doseOn };
}

/** A quiet period needs two different whole hours; anything else is rejected and the old value is kept. */
export function setQuiet(prefs: ReminderPrefs, quiet: QuietHours | null): ReminderPrefs {
  if (quiet === null) return { ...prefs, quiet: null };
  const ok =
    Number.isInteger(quiet.startHour) &&
    Number.isInteger(quiet.endHour) &&
    quiet.startHour >= 0 &&
    quiet.startHour <= 23 &&
    quiet.endHour >= 0 &&
    quiet.endHour <= 23 &&
    quiet.startHour !== quiet.endHour;
  return ok ? { ...prefs, quiet: { startHour: quiet.startHour, endHour: quiet.endHour } } : prefs;
}

function sanitiseReminder(raw: unknown): BpReminder | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; times?: unknown; days?: unknown; active?: unknown };
  if (typeof r.id !== "string" || r.id === "" || !Array.isArray(r.times)) return null;
  const days = r.days === null ? [0, 1, 2, 3, 4, 5, 6] : Array.isArray(r.days) ? (r.days as unknown[]).filter((d): d is number => typeof d === "number") : null;
  if (days === null) return null;
  const n = normaliseDraft({ times: (r.times as unknown[]).filter((t): t is string => typeof t === "string"), days });
  if (!n.ok) return null;
  return { id: r.id, times: n.times, days: n.days, active: r.active !== false };
}

/** Turns whatever was saved into valid settings. Anything unusable is dropped; nothing throws. */
export function sanitizePrefs(raw: unknown): ReminderPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const r = raw as { version?: unknown; bp?: unknown; doseOn?: unknown; quiet?: unknown };
  if (r.version !== 1) return DEFAULT_PREFS;
  const bp = (Array.isArray(r.bp) ? r.bp : [])
    .map(sanitiseReminder)
    .filter((x): x is BpReminder => x !== null)
    .slice(0, MAX_BP_REMINDERS);
  const base: ReminderPrefs = { version: 1, bp, doseOn: typeof r.doseOn === "boolean" ? r.doseOn : DEFAULT_PREFS.doseOn, quiet: null };
  const q = r.quiet as { startHour?: unknown; endHour?: unknown } | null | undefined;
  return q && typeof q === "object"
    ? setQuiet(base, { startHour: q.startHour as number, endHour: q.endHour as number })
    : base;
}

const keyFor = (userId: string) => `@tarragon/reminder-prefs/v1:${userId}`;

export async function loadReminderPrefs(userId: string): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? sanitizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** True once saved. A failed save is reported so the screen can say so, never swallowed. */
export async function saveReminderPrefs(userId: string, prefs: ReminderPrefs): Promise<boolean> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
