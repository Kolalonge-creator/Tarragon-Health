/**
 * On-device emergency logic (S65, INV-01, INV-06). Pure functions, no network, no model. They run on the phone so that "go to the
 * nearest hospital now" appears with no signal, for the readings the phone can classify itself (pulse, SpO2, temperature) and for the
 * symptom topics in the bundled emergency pack.
 *
 * The thresholds are PROPOSED configuration (`vitals.device_red_rules`), passed in by the caller, never written here. They copy the live
 * SQL classifiers; `emergency-pack.test.ts` reads the migrations and fails if either side moves.
 *
 * The pack is a DRAFT until the CMO signs it. `activeEmergencyPack` therefore returns the always-safe first line and the facilities list
 * on an unsigned pack, and the clinical topic cards only once `signed` is set. An agent never sets `signed`.
 */
import { screenWrittenQuestion } from "./written-question-screen";

export type DeviceLevel = "unknown" | "green" | "amber" | "red" | "emergency";

export interface DeviceRedRules {
  readonly pulse_bpm: {
    readonly emergency_at_or_below: number; readonly emergency_at_or_above: number;
    readonly red_at_or_below: number; readonly red_at_or_above: number;
    readonly amber_at_or_below: number; readonly amber_at_or_above: number;
  };
  readonly spo2_pct: { readonly emergency_below: number; readonly red_at_or_below: number; readonly amber_at_or_below: number };
  readonly temperature_c: {
    readonly emergency_at_or_above: number; readonly emergency_below: number; readonly red_at_or_above: number; readonly amber_at_or_above: number;
  };
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function classifyPulse(bpm: number | null | undefined, r: DeviceRedRules): DeviceLevel {
  if (!finite(bpm)) return "unknown";
  const p = r.pulse_bpm;
  if (bpm <= p.emergency_at_or_below || bpm >= p.emergency_at_or_above) return "emergency";
  if (bpm <= p.red_at_or_below || bpm >= p.red_at_or_above) return "red";
  if (bpm <= p.amber_at_or_below || bpm >= p.amber_at_or_above) return "amber";
  return "green";
}

export function classifySpo2(pct: number | null | undefined, r: DeviceRedRules): DeviceLevel {
  if (!finite(pct)) return "unknown";
  const s = r.spo2_pct;
  if (pct < s.emergency_below) return "emergency";
  if (pct <= s.red_at_or_below) return "red";
  if (pct <= s.amber_at_or_below) return "amber";
  return "green";
}

export function classifyTemperature(c: number | null | undefined, r: DeviceRedRules): DeviceLevel {
  if (!finite(c)) return "unknown";
  const t = r.temperature_c;
  if (c >= t.emergency_at_or_above || c < t.emergency_below) return "emergency";
  if (c >= t.red_at_or_above) return "red";
  if (c >= t.amber_at_or_above) return "amber";
  return "green";
}

const ORDER: Record<DeviceLevel, number> = { unknown: 0, green: 1, amber: 2, red: 3, emergency: 4 };

export type DeviceVital = "pulse_bpm" | "spo2_pct" | "temperature_c";
export interface DeviceReading { readonly pulse_bpm?: number | null; readonly spo2_pct?: number | null; readonly temperature_c?: number | null }
export interface DeviceFlag { readonly vital: DeviceVital; readonly level: DeviceLevel; readonly topic: EmergencyTopicKeyLike | null }
export type EmergencyTopicKeyLike =
  | "chest_pain" | "stroke" | "severe_blood_pressure" | "low_blood_sugar" | "seizure" | "pregnancy_danger" | "severe_breathlessness" | "malaria_danger" | "lassa_warning";

/** Every vital given, worst first. Only red and emergency show the "hospital now" card; amber is for the care team's own flow. */
export function deviceRedFlags(reading: DeviceReading, rules: DeviceRedRules): DeviceFlag[] {
  const flags: DeviceFlag[] = [
    { vital: "pulse_bpm" as const, level: classifyPulse(reading.pulse_bpm, rules), topic: null },
    { vital: "spo2_pct" as const, level: classifySpo2(reading.spo2_pct, rules), topic: "severe_breathlessness" as const },
    { vital: "temperature_c" as const, level: classifyTemperature(reading.temperature_c, rules), topic: null },
  ].filter((f) => f.level !== "unknown");
  return flags.sort((a, b) => ORDER[b.level] - ORDER[a.level]);
}

export function needsHospitalNow(flags: readonly DeviceFlag[]): boolean {
  return flags.some((f) => f.level === "red" || f.level === "emergency");
}

/** Danger phrases the written-question screen already carries, grouped to the pack topic they point at. Anything not listed still shows
 * the first line (over-triggering is the accepted failure). */
const PHRASE_TOPICS: ReadonlyArray<readonly [EmergencyTopicKeyLike, readonly string[]]> = [
  ["chest_pain", ["chest pain"]],
  ["stroke", ["stroke", "face drooping", "slurred speech", "one side weak", "can't move my"]],
  ["seizure", ["seizure", "convulsion", "convulsing", "fitting"]],
  ["severe_breathlessness", ["can't breathe", "cannot breathe", "difficulty breathing", "struggling to breathe", "blue lips", "turning blue", "not breathing"]],
];

/** Free text typed into a symptom box: the deterministic danger-phrase screen, then the topic it points at (or null with redFlag true). */
export function emergencyForText(text: string): { redFlag: boolean; topic: EmergencyTopicKeyLike | null } {
  const screen = screenWrittenQuestion(text);
  if (!screen.redFlag) return { redFlag: false, topic: null };
  for (const [topic, phrases] of PHRASE_TOPICS) if (screen.matched.some((m) => phrases.includes(m))) return { redFlag: true, topic };
  return { redFlag: true, topic: null };
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------
export interface PackFacility { readonly name: string; readonly address: string; readonly latitude: number | null; readonly longitude: number | null; readonly last_verified_on: string }
export interface PackState { readonly code: string; readonly name: string; readonly facilities: readonly PackFacility[]; readonly none_listed: boolean }
export interface PackTopic { readonly key: string; readonly title: string; readonly signs: readonly string[]; readonly steps: readonly string[]; readonly never: readonly string[] }
export interface PackLike {
  readonly status: "draft" | "signed";
  readonly signed: null | { readonly by: string; readonly on: string; readonly version: number };
  readonly first_line: string;
  readonly topics: readonly PackTopic[];
  readonly states: readonly PackState[];
}

export interface ActiveEmergencyPack {
  /** Always shown first, signed or not. */
  readonly firstLine: string;
  /** Empty until the CMO has signed the pack. */
  readonly topics: readonly PackTopic[];
  readonly isDraft: boolean;
  readonly states: readonly PackState[];
}

export function activeEmergencyPack(pack: PackLike): ActiveEmergencyPack {
  const signed = pack.status === "signed" && pack.signed !== null;
  return { firstLine: pack.first_line, topics: signed ? pack.topics : [], isDraft: !signed, states: pack.states };
}

export interface StateFacilities { readonly state: string; readonly facilities: readonly PackFacility[]; readonly noneListed: boolean }

/** The facilities for one state, or an explicit none-listed answer. An unknown state code is also none-listed, never a silent blank. */
export function emergencyFacilitiesForState(pack: PackLike, stateCode: string): StateFacilities {
  const s = pack.states.find((x) => x.code.toLowerCase() === stateCode.trim().toLowerCase() || x.name.toLowerCase() === stateCode.trim().toLowerCase());
  if (!s) return { state: stateCode, facilities: [], noneListed: true };
  return { state: s.name, facilities: s.facilities, noneListed: s.facilities.length === 0 };
}

export function topicByKey(pack: ActiveEmergencyPack, key: string): PackTopic | null {
  return pack.topics.find((t) => t.key === key) ?? null;
}

/** For the lint/test: a telephone number or a banned emergency number anywhere in a pack's text (CMO Q18). Returns the offending strings. */
export function findNumbersInPack(pack: PackLike): string[] {
  const hits: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (/(^|[^0-9.])[0-9]{7,}/.test(v) || /(^|[^0-9.])\+?[0-9][0-9 ()-]{8,}[0-9]/.test(v) || /(^|[^0-9.])(112|767|199|911)([^0-9]|$)/.test(v) || /tel:/i.test(v)) hits.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(pack);
  return hits;
}
