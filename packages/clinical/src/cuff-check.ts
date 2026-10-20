/**
 * S07y: "home cuff vs clinic cuff". Pure, deterministic, no clock, network or model (INV-01): `nowMs` is an input.
 *
 * Cheap unvalidated cuffs are common. When the care team has a clinic reading beside the patient's own cuff reading (a same-visit pair, or the mean of
 * the patient's home log around a clinic reading), the difference says something about the cuff, not the patient. If the own cuff reads differently
 * from the clinic cuff by at least the configured amount, in the SAME direction, across enough pairs, a clinician-only flag asks the team to consider
 * a cuff check.
 *
 * Every number comes from the versioned configuration (`bp.cuff_check`, mirrored by the database row `cuff_check_rules`). The numbers are PROPOSED and
 * unsigned until the Chief Medical Officer signs that row (INV-14, INV-16). The result is for a routine clinician task only: never a diagnosis, never
 * shown to the patient, never in a notification (INV-07), never changes a medicine (INV-02).
 *
 * The same rules are written in SQL (`private.cuff_pair_class`, `private.cuff_home_mean`, `private.cuff_check_kind`); the parity block inside
 * `packages/db/tests/s07y_cuff_check.sql` is run through both.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface CuffCheckConfig {
  readonly version: number;
  readonly pairing: { readonly windowHours: number; readonly minHomeReadings: number };
  /** mmHg. A pair is "off" when own minus clinic reaches either number, in either direction. */
  readonly difference: { readonly systolic: number; readonly diastolic: number };
  readonly consistency: {
    readonly minPairs: number;
    readonly maxPairs: number;
    readonly lookbackDays: number;
    /** Whole percent of the pairs considered that must be off in the same direction. */
    readonly minSharePercent: number;
  };
  readonly tasks: { readonly reviewDueMinutes: number };
}

export type PairClass = "home_higher" | "home_lower" | "mixed" | "agree";
export type CuffFlagKind = "home_higher" | "home_lower";

export interface BpValue {
  readonly systolic: number;
  readonly diastolic: number;
}

export interface TimedBp extends BpValue {
  readonly atMs: number;
}

export interface PairDifference {
  readonly atMs: number;
  /** Own cuff minus clinic cuff. */
  readonly dSys: number;
  readonly dDia: number;
}

/** Own cuff minus clinic cuff. */
export function pairDifference(own: BpValue, clinic: BpValue, atMs: number): PairDifference {
  return { atMs, dSys: own.systolic - clinic.systolic, dDia: own.diastolic - clinic.diastolic };
}

/** One pair: higher when either number is at least the threshold above, lower when either is at least the threshold below, mixed when both happen. */
export function classifyPair(d: { readonly dSys: number; readonly dDia: number }, cfg: CuffCheckConfig): PairClass {
  const t = cfg.difference;
  const higher = d.dSys >= t.systolic || d.dDia >= t.diastolic;
  const lower = d.dSys <= -t.systolic || d.dDia <= -t.diastolic;
  if (higher && lower) return "mixed";
  if (higher) return "home_higher";
  if (lower) return "home_lower";
  return "agree";
}

/**
 * The patient's own home readings taken within `windowHours` either side of a clinic reading, averaged (rounded half up). Fewer than `minHomeReadings`
 * means there is no pair at all (one reading says too little about the cuff).
 */
export function homeMeanAround(readings: readonly TimedBp[], clinicAtMs: number, cfg: CuffCheckConfig): (BpValue & { readonly count: number }) | null {
  const windowMs = cfg.pairing.windowHours * HOUR_MS;
  const near = readings.filter((r) => Math.abs(r.atMs - clinicAtMs) <= windowMs);
  if (near.length < cfg.pairing.minHomeReadings) return null;
  const sum = near.reduce((a, r) => ({ s: a.s + r.systolic, d: a.d + r.diastolic }), { s: 0, d: 0 });
  return { systolic: Math.round(sum.s / near.length), diastolic: Math.round(sum.d / near.length), count: near.length };
}

export interface CuffCheckResult {
  readonly kind: CuffFlagKind | null;
  /** How many pairs were considered (newest first, capped, inside the look-back). */
  readonly pairsUsed: number;
  /** How many of them were off in the flagged direction (0 when none). */
  readonly matching: number;
}

/**
 * Consistently off: among the newest `maxPairs` pairs inside the look-back, at least `minPairs` exist, and at least `minPairs` of them AND at least
 * `minSharePercent` percent of them are off in the same direction. Mixed pairs count as neither direction. Both directions qualifying raises nothing.
 */
export function evaluateCuffCheck(pairs: readonly PairDifference[], nowMs: number, cfg: CuffCheckConfig): CuffCheckResult {
  const c = cfg.consistency;
  const used = pairs
    .filter((p) => p.atMs <= nowMs && nowMs - p.atMs <= c.lookbackDays * DAY_MS)
    .sort((a, b) => b.atMs - a.atMs || b.dSys - a.dSys || b.dDia - a.dDia)
    .slice(0, c.maxPairs);
  if (used.length < c.minPairs) return { kind: null, pairsUsed: used.length, matching: 0 };
  let higher = 0;
  let lower = 0;
  for (const p of used) {
    const k = classifyPair(p, cfg);
    if (k === "home_higher") higher += 1;
    else if (k === "home_lower") lower += 1;
  }
  const enough = (n: number) => n >= c.minPairs && n * 100 >= c.minSharePercent * used.length;
  const hi = enough(higher);
  const lo = enough(lower);
  if (hi && !lo) return { kind: "home_higher", pairsUsed: used.length, matching: higher };
  if (lo && !hi) return { kind: "home_lower", pairsUsed: used.length, matching: lower };
  return { kind: null, pairsUsed: used.length, matching: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Loading the configuration. A malformed value is refused loudly, never half-applied.
// ---------------------------------------------------------------------------------------------------------------------------------
type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function section(raw: Raw, name: string): Raw {
  const v = raw[name];
  if (!isRecord(v)) throw new Error(`cuff check config: ${name} must be an object`);
  return v;
}
function whole(raw: Raw, name: string, field: string, min: number): number {
  const v = raw[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Error(`cuff check config: ${name}.${field} must be a whole number of at least ${min}`);
  return v;
}

/** Turn the stored value (registry entry or signed database row) into a typed, checked configuration. */
export function parseCuffCheckConfig(version: number, value: unknown): CuffCheckConfig {
  if (!isRecord(value)) throw new Error("cuff check config must be an object");
  const p = section(value, "pairing");
  const d = section(value, "difference");
  const c = section(value, "consistency");
  const t = section(value, "tasks");
  const cfg: CuffCheckConfig = {
    version,
    pairing: { windowHours: whole(p, "pairing", "windowHours", 1), minHomeReadings: whole(p, "pairing", "minHomeReadings", 1) },
    difference: { systolic: whole(d, "difference", "systolic", 1), diastolic: whole(d, "difference", "diastolic", 1) },
    consistency: {
      minPairs: whole(c, "consistency", "minPairs", 2),
      maxPairs: whole(c, "consistency", "maxPairs", 2),
      lookbackDays: whole(c, "consistency", "lookbackDays", 1),
      minSharePercent: whole(c, "consistency", "minSharePercent", 51),
    },
    tasks: { reviewDueMinutes: whole(t, "tasks", "reviewDueMinutes", 1) },
  };
  if (cfg.consistency.maxPairs < cfg.consistency.minPairs) throw new Error("cuff check config: consistency.maxPairs cannot be below consistency.minPairs");
  if (cfg.consistency.minSharePercent > 100) throw new Error("cuff check config: consistency.minSharePercent cannot exceed 100");
  return cfg;
}
