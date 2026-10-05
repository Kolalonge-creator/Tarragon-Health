import { getProposedConfig } from "@tarragon/shared";

/**
 * Typed loaders for the medicines values in the versioned registry
 * (packages/shared/src/proposed-config). Same rule as s07-config.ts: every number
 * the screens and reminder planner use is read from here, never written at a call
 * site, and a malformed registry entry fails loudly in a test, not on a phone.
 *
 * The server holds the matching values in `medicine_config` (one active row, the
 * missed window and the low-supply days), the same split S06 used for
 * `offline_sync_config`. A test keeps the two equal.
 */
export interface MedicineRulesConfig {
  version: number;
  undoSeconds: number;
  doubleTapGuardMs: number;
  lowSupplyDays: number;
  adherenceMinDoses: number;
  stalePlanHours: number;
  followUpMinWindowMinutes: number;
  catchUpMaxItems: number;
  catchUpMinGapMinutes: number;
  serverMissedAfterMinutes: number;
  backdateWindowHours: number;
  futureSkewMinutes: number;
}

export interface AdherenceBandConfig {
  version: number;
  percent: number;
  windowDays: number;
}

type Raw = Record<string, unknown>;

function obj(key: string, asOf?: string): { raw: Raw; version: number } {
  const r = getProposedConfig(key, asOf);
  if (typeof r.value !== "object" || r.value === null || Array.isArray(r.value)) {
    throw new Error(`Config ${key} must be an object`);
  }
  return { raw: r.value as Raw, version: r.version };
}

function num(raw: Raw, field: string, key: string, min = 0): number {
  const v = raw[field];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) {
    throw new Error(`Config ${key}.${field} must be a number >= ${min}`);
  }
  return v;
}

export function loadMedicineRules(asOf?: string): MedicineRulesConfig {
  const key = "medicines.dose_rules";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    undoSeconds: num(raw, "undoSeconds", key, 1),
    doubleTapGuardMs: num(raw, "doubleTapGuardMs", key),
    lowSupplyDays: num(raw, "lowSupplyDays", key, 1),
    adherenceMinDoses: num(raw, "adherenceMinDoses", key, 1),
    stalePlanHours: num(raw, "stalePlanHours", key, 1),
    followUpMinWindowMinutes: num(raw, "followUpMinWindowMinutes", key, 1),
    catchUpMaxItems: num(raw, "catchUpMaxItems", key, 1),
    catchUpMinGapMinutes: num(raw, "catchUpMinGapMinutes", key, 1),
    serverMissedAfterMinutes: num(raw, "serverMissedAfterMinutes", key, 1),
    backdateWindowHours: num(raw, "backdateWindowHours", key, 1),
    futureSkewMinutes: num(raw, "futureSkewMinutes", key),
  };
}

export function loadAdherenceBand(asOf?: string): AdherenceBandConfig {
  const key = "adherence.threshold";
  const { raw, version } = obj(key, asOf);
  return { version, percent: num(raw, "percent", key, 1), windowDays: num(raw, "windowDays", key, 1) };
}
