/**
 * Home pins: which tiles a patient keeps on their Overview / Home screen.
 *
 * A closed catalogue, shared by web and the native app so both draw the same
 * choices and a pin saved on one device appears on the other. The list is
 * closed on purpose: every key needs a tile renderer and a destination on
 * both surfaces, and the database CHECK (patient_home_layout.pinned) mirrors
 * HOME_PIN_KEYS, so a key added here needs a migration too.
 *
 * Vitals and medications are where every patient starts. Anything else is
 * something the patient chooses to add.
 */

export const HOME_PIN_KEYS = [
  // Vitals: a tile with the latest reading.
  "bp",
  "glucose",
  "weight",
  "pulse",
  "spo2",
  "temperature",
  "waist",
  "peak_flow",
  // Medications.
  "active_meds",
  "doses_today",
  // Other things a patient may want to keep track of: a shortcut tile.
  "sleep",
  "meals",
  "exercise",
  "symptoms",
  "mood",
  // Care.
  "labs",
  "appointments",
  "screenings",
  "messages",
] as const;

export type HomePinKey = (typeof HOME_PIN_KEYS)[number];

export const HOME_PIN_GROUPS = ["vitals", "medications", "tracking", "care"] as const;
export type HomePinGroup = (typeof HOME_PIN_GROUPS)[number];

export const HOME_PIN_GROUP: Record<HomePinKey, HomePinGroup> = {
  bp: "vitals",
  glucose: "vitals",
  weight: "vitals",
  pulse: "vitals",
  spo2: "vitals",
  temperature: "vitals",
  waist: "vitals",
  peak_flow: "vitals",
  active_meds: "medications",
  doses_today: "medications",
  sleep: "tracking",
  meals: "tracking",
  exercise: "tracking",
  symptoms: "tracking",
  mood: "tracking",
  labs: "care",
  appointments: "care",
  screenings: "care",
  messages: "care",
};

export const HOME_PIN_GROUP_LABEL: Record<HomePinGroup, string> = {
  vitals: "Vitals",
  medications: "Medications",
  tracking: "Other things to track",
  care: "Care",
};

/** Plain English names. The native app reads these through @tarragon/i18n instead. */
export const HOME_PIN_LABEL: Record<HomePinKey, string> = {
  bp: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Pulse",
  spo2: "Oxygen level",
  temperature: "Temperature",
  waist: "Waist",
  peak_flow: "Peak flow",
  active_meds: "Active medications",
  doses_today: "Doses today",
  sleep: "Sleep",
  meals: "Meals",
  exercise: "Exercise",
  symptoms: "Symptoms",
  mood: "Mood and wellbeing",
  labs: "Labs and results",
  appointments: "Appointments",
  screenings: "Screenings due",
  messages: "Messages",
};

/** The vitals_readings.vital_type behind each vitals pin. */
export const HOME_PIN_VITAL_TYPE = {
  bp: "blood_pressure",
  glucose: "glucose",
  weight: "weight",
  pulse: "pulse",
  spo2: "spo2",
  temperature: "temperature",
  waist: "waist_circumference",
  peak_flow: "peak_flow",
} as const satisfies Partial<Record<HomePinKey, string>>;

export type HomeVitalPinKey = keyof typeof HOME_PIN_VITAL_TYPE;

export function isHomeVitalPin(key: HomePinKey): key is HomeVitalPinKey {
  return key in HOME_PIN_VITAL_TYPE;
}

/** What a patient with nothing saved sees: the same four tiles the Overview has always led with. */
export const DEFAULT_HOME_PINS: readonly HomePinKey[] = ["bp", "glucose", "active_meds", "doses_today"];

/** Enough to be useful, few enough that the home screen stays a summary. */
export const MAX_HOME_PINS = 12;

export function isHomePinKey(value: unknown): value is HomePinKey {
  return typeof value === "string" && (HOME_PIN_KEYS as readonly string[]).includes(value);
}

/** Drops anything unknown, removes duplicates (first one wins) and caps the length. Never throws. */
export function sanitizeHomePins(input: unknown): HomePinKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<HomePinKey>();
  for (const item of input) {
    if (isHomePinKey(item) && !seen.has(item)) seen.add(item);
    if (seen.size >= MAX_HOME_PINS) break;
  }
  return [...seen];
}

export interface HomePinLockContext {
  activeMedicationCount: number;
  /**
   * vitals_readings.vital_type values the patient's enrolled chronic programme(s) monitor
   * (chronic_condition_programmes.monitoring_vitals). Omitted means none known.
   */
  monitoredVitals?: readonly string[];
}

/**
 * Pins the patient cannot remove: the ones their care relies on, so tidying the screen cannot
 * hide them. Today's doses for anyone taking a medication, and the tile for each vital their
 * enrolled programme monitors (for example blood pressure for hypertension). Everything else is
 * the patient's choice.
 */
export function lockedHomePins(ctx: HomePinLockContext): HomePinKey[] {
  const locked: HomePinKey[] = [];
  const monitored = ctx.monitoredVitals ?? [];
  for (const key of HOME_PIN_KEYS) {
    if (isHomeVitalPin(key) && monitored.includes(HOME_PIN_VITAL_TYPE[key])) locked.push(key);
  }
  if (ctx.activeMedicationCount > 0) locked.push("doses_today");
  return locked;
}

/**
 * The pins to draw, in order. `stored` is the saved list: null or undefined
 * means the patient has never customised their home screen, so they get the
 * defaults (the caller may pass its own, e.g. a preventive-care patient leads
 * with fewer tiles); an empty list means they chose to show nothing. Locked pins are
 * always added back here, on every read, so a stale or hand-edited row can
 * never hide one.
 */
export function resolveHomePins(
  stored: unknown,
  ctx: HomePinLockContext,
  defaults: readonly HomePinKey[] = DEFAULT_HOME_PINS,
): HomePinKey[] {
  const base = stored == null ? sanitizeHomePins(defaults) : sanitizeHomePins(stored);
  const locked = lockedHomePins(ctx);
  const missing = locked.filter((key) => !base.includes(key));
  // Keep the locked ones even when the list is already full.
  const room = MAX_HOME_PINS - missing.length;
  return [...base.slice(0, Math.max(room, 0)), ...missing];
}

/** Adds the key at the end, or removes it. A locked key can never be removed. */
export function togglePin(pins: readonly HomePinKey[], key: HomePinKey, locked: readonly HomePinKey[]): HomePinKey[] {
  if (pins.includes(key)) {
    if (locked.includes(key)) return [...pins];
    return pins.filter((k) => k !== key);
  }
  if (pins.length >= MAX_HOME_PINS) return [...pins];
  return [...pins, key];
}

/** Moves one pin a single place up or down. Out-of-range moves leave the list as it was. */
export function movePin(pins: readonly HomePinKey[], key: HomePinKey, direction: "up" | "down"): HomePinKey[] {
  const from = pins.indexOf(key);
  if (from === -1) return [...pins];
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= pins.length) return [...pins];
  const next = [...pins];
  const moved = next[from] as HomePinKey;
  next[from] = next[to] as HomePinKey;
  next[to] = moved;
  return next;
}

/** The vitals_readings column each value-bearing vitals pin reads. Blood pressure and glucose are read elsewhere (two columns, and glucose has a display unit). */
export const HOME_PIN_VITAL_COLUMN = {
  weight: "weight_kg",
  pulse: "pulse_bpm",
  spo2: "spo2_pct",
  temperature: "temperature_c",
  waist: "waist_cm",
  peak_flow: "peak_flow_l_min",
} as const;

export type HomeValuePinKey = keyof typeof HOME_PIN_VITAL_COLUMN;

export function isHomeValuePin(key: HomePinKey): key is HomeValuePinKey {
  return key in HOME_PIN_VITAL_COLUMN;
}

const HOME_PIN_VITAL_UNIT: Record<HomeValuePinKey, string> = {
  weight: "kg",
  pulse: "bpm",
  spo2: "%",
  temperature: "\u00b0C",
  waist: "cm",
  peak_flow: "L/min",
};

/** A wearable's pulse, oxygen or temperature is an estimate, never "the latest reading" (the same rule as blood pressure). */
export const HOME_PIN_NEVER_FROM_WEARABLE: readonly HomePinKey[] = ["pulse", "spo2", "temperature"];

export interface HomePinVitalValue {
  value: string;
  unit: string;
}

/** What a vitals tile shows for a raw column value, or null when there is no usable number (the tile then says "no reading yet"). */
export function homePinVitalDisplay(key: HomeValuePinKey, raw: unknown): HomePinVitalValue | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // One decimal for the figures people read that way; whole numbers for the rest.
  const oneDecimal = key === "weight" || key === "temperature";
  const value = oneDecimal ? (Math.round(raw * 10) / 10).toFixed(1) : String(Math.round(raw));
  return { value, unit: HOME_PIN_VITAL_UNIT[key] };
}
