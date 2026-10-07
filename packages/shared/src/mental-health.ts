/**
 * Mental wellbeing helpers shared by web and mobile (S56, Module 10). Pure code: no network, no model, no clinical threshold.
 * Every PROPOSED clinical value lives in the database config rows mirrored in ./proposed-config (follow-up timings, crisis card).
 *
 * What is here:
 *   - the check-in tag list (the same fixed list the database CHECK allows)
 *   - mood beside blood pressure and sleep, merged per Lagos calendar day (function 10.1)
 *   - change over time for a repeated questionnaire (function 10.2). It reports the raw difference only: calling a
 *     difference "reliable" or "clinically significant" is a clinical threshold the CMO has not signed, so none is applied.
 *   - the crisis card content that is bundled in the app binary (INV-06): the emergency number and the go-to-the-nearest-hospital
 *     guidance (function 10.3). No helpline numbers (founder decision 2026-10-07).
 */

export const WELLBEING_TAGS = ["work", "money", "family", "relationships", "health", "sleep", "grief", "faith", "exams", "loneliness", "other"] as const;
export type WellbeingTag = (typeof WELLBEING_TAGS)[number];
export const MAX_WELLBEING_TAGS = 6;

/** Keeps only known tags, once each, at most MAX_WELLBEING_TAGS. */
export function cleanWellbeingTags(input: unknown): WellbeingTag[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" && input.length > 0 ? input.split(",") : [];
  const out: WellbeingTag[] = [];
  for (const v of raw) {
    const t = typeof v === "string" ? v.trim() : "";
    if ((WELLBEING_TAGS as readonly string[]).includes(t) && !out.includes(t as WellbeingTag)) out.push(t as WellbeingTag);
    if (out.length === MAX_WELLBEING_TAGS) break;
  }
  return out;
}

const LAGOS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });
/** YYYY-MM-DD of an instant in Africa/Lagos. */
export function lagosDay(iso: string): string {
  return LAGOS_DAY.format(new Date(iso));
}

export interface MoodCheckinPoint { checked_in_at: string; mood_score: number; stress_score: number; tags?: string[] }
export interface BpPoint { taken_at: string; systolic: number | null; diastolic: number | null }
export interface SleepPoint { day: string; minutes: number }
export interface MoodTrendDay {
  day: string;
  /** Mean of that day's check-ins, 1 to 5, one decimal. null when there was none. */
  mood: number | null;
  stress: number | null;
  tags: string[];
  /** Mean of that day's blood pressure readings (rounded). null when there was none. */
  systolic: number | null;
  diastolic: number | null;
  sleepMinutes: number | null;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/**
 * One row per Lagos day that has at least one of the three, oldest first, so mood can be read beside blood pressure and sleep.
 * It describes; it never says one caused the other and it never scores anything.
 */
export function mergeMoodBpSleep(checkins: readonly MoodCheckinPoint[], bp: readonly BpPoint[], sleep: readonly SleepPoint[]): MoodTrendDay[] {
  const days = new Map<string, { mood: number[]; stress: number[]; tags: Set<string>; sys: number[]; dia: number[]; sleep: number[] }>();
  const slot = (d: string) => {
    let s = days.get(d);
    if (!s) { s = { mood: [], stress: [], tags: new Set(), sys: [], dia: [], sleep: [] }; days.set(d, s); }
    return s;
  };
  for (const c of checkins) {
    const s = slot(lagosDay(c.checked_in_at));
    s.mood.push(c.mood_score); s.stress.push(c.stress_score);
    for (const t of c.tags ?? []) s.tags.add(t);
  }
  for (const b of bp) {
    if (b.systolic === null || b.diastolic === null) continue;
    const s = slot(lagosDay(b.taken_at));
    s.sys.push(b.systolic); s.dia.push(b.diastolic);
  }
  for (const m of sleep) slot(m.day).sleep.push(m.minutes);
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, s]) => ({
    day,
    mood: round1(mean(s.mood)),
    stress: round1(mean(s.stress)),
    tags: [...s.tags].sort(),
    systolic: s.sys.length ? Math.round(mean(s.sys) as number) : null,
    diastolic: s.dia.length ? Math.round(mean(s.dia) as number) : null,
    sleepMinutes: s.sleep.length ? Math.round(mean(s.sleep) as number) : null,
  }));
}

export interface ScreenPoint { instrument: string; total_score: number; severity_band: string; created_at: string }
export interface ChangeOverTime {
  instrument: string;
  points: { at: string; total: number; band: string }[];
  first: number | null;
  latest: number | null;
  previous: number | null;
  /** latest minus first, latest minus previous. null with fewer than two points. */
  sinceFirst: number | null;
  sincePrevious: number | null;
  /** Direction of the score only. For PHQ-9, GAD-7 and EPDS a lower score is fewer symptoms. Not a clinical judgement. */
  direction: "lower" | "higher" | "same" | null;
}

/** Oldest first. Works for any instrument; AUDIT-C is allowed too (a lower score is lower risk). */
export function changeOverTime(screens: readonly ScreenPoint[], instrument: string): ChangeOverTime {
  const points = screens
    .filter((s) => s.instrument === instrument)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map((s) => ({ at: s.created_at, total: s.total_score, band: s.severity_band }));
  const first = points[0]?.total ?? null;
  const latest = points.length ? (points[points.length - 1] as { total: number }).total : null;
  const previous = points.length > 1 ? (points[points.length - 2] as { total: number }).total : null;
  const sinceFirst = points.length > 1 && first !== null && latest !== null ? latest - first : null;
  const sincePrevious = previous !== null && latest !== null ? latest - previous : null;
  const direction = sincePrevious === null ? null : sincePrevious < 0 ? "lower" : sincePrevious > 0 ? "higher" : "same";
  return { instrument, points, first, latest, previous, sinceFirst, sincePrevious, direction };
}

// ---- Crisis card (10.3) ----------------------------------------------------------------------------------------------
/**
 * Bundled in the app binary and the web bundle, so it renders with no signal (INV-06). The number is the national emergency line
 * and the card always ALSO says to go to the nearest hospital, because the line does not connect everywhere. The server config row
 * (crisis_card_config) can change the number, and the device keeps the last copy; this is the fallback when neither is reachable.
 */
export const CRISIS_CARD_OFFLINE = {
  emergencyNumber: "112",
  helplines: [] as CrisisHelpline[],
  callbackSlaMinutes: null as number | null,
} as const;

/**
 * Kept only so older callers still type-check. FOUNDER DECISION 2026-10-07: there are no usable crisis helplines in Nigeria, so the card
 * never shows one and `helplines` is always empty. If helplines are added later, add a new verified-only gate with them (a number must
 * never be shown unless a human has verified it) and a new card section; do not just start filling this list.
 */
export interface CrisisHelpline { name: string; phone_e164: string | null; hours_text: string | null; languages: string[]; last_verified_at: string | null }
export interface CrisisCardData { emergencyNumber: string; helplines: CrisisHelpline[]; callbackSlaMinutes: number | null }

/**
 * Reads the get_crisis_card() response defensively. A malformed response, or no response, gives the bundled card: never an error
 * screen. Any helpline the server (or an old cached copy) sends is ignored, so no number other than the emergency number is ever shown.
 */
export function normaliseCrisisCard(raw: unknown): CrisisCardData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const number = typeof r.emergency_number === "string" && /^[0-9+]{3,15}$/.test(r.emergency_number) ? r.emergency_number : CRISIS_CARD_OFFLINE.emergencyNumber;
  const sla = typeof r.callback_sla_minutes === "number" && Number.isInteger(r.callback_sla_minutes) && r.callback_sla_minutes > 0 ? r.callback_sla_minutes : null;
  return { emergencyNumber: number, helplines: [], callbackSlaMinutes: sla };
}

// ---- Shared-phone mode -------------------------------------------------------------------------------------------------
/** What a lock screen, a notification preview or a task switcher may show while shared-phone mode is on (or always, for mental wellbeing). */
export const SHARED_PHONE_NEUTRAL_TEXT = { title: "TarragonHealth", body: "You have something waiting in the app." } as const;

/** Local PIN rules: 4 to 8 digits. The PIN never leaves the device. */
export function isValidSharedPhonePin(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin);
}

// ---- Hand-off (10.13) ----------------------------------------------------------------------------------------------------
/**
 * Which saved screen a patient's hand-off to the care team attaches: a crisis-flagged one first, otherwise the newest of PHQ-9, GAD-7
 * and EPDS. No band or score threshold is applied here: the patient may always send their latest answers.
 */
export function pickHandoffScreen<T extends { id: string; instrument: string; crisis_flagged: boolean; created_at: string }>(screens: readonly T[]): T | null {
  const eligible = screens.filter((s) => s.instrument === "phq9" || s.instrument === "gad7" || s.instrument === "epds");
  if (eligible.length === 0) return null;
  const byNewest = [...eligible].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return byNewest.find((s) => s.crisis_flagged) ?? (byNewest[0] as T);
}
