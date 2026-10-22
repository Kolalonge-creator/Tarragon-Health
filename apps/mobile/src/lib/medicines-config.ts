import { getProposedConfig } from "@tarragon/shared";
import type { NafdacHelperConfig, ReminderReliabilityConfig, RunwayConfig } from "@tarragon/medicines";

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
  catchUpRetrySeconds: readonly number[];
  serverMissedAfterMinutes: number;
  backdateWindowHours: number;
  futureSkewMinutes: number;
  maxFollowUps: number;
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

function numList(raw: Raw, field: string, key: string): readonly number[] {
  const v = raw[field];
  if (!Array.isArray(v) || v.length > 5 || v.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 1)) {
    throw new Error(`Config ${key}.${field} must be a list of up to 5 numbers >= 1`);
  }
  return v as number[];
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
    catchUpRetrySeconds: numList(raw, "catchUpRetrySeconds", key),
    serverMissedAfterMinutes: num(raw, "serverMissedAfterMinutes", key, 1),
    backdateWindowHours: num(raw, "backdateWindowHours", key, 1),
    futureSkewMinutes: num(raw, "futureSkewMinutes", key),
    maxFollowUps: num(raw, "maxFollowUps", key),
  };
}

export function loadAdherenceBand(asOf?: string): AdherenceBandConfig {
  const key = "adherence.threshold";
  const { raw, version } = obj(key, asOf);
  return { version, percent: num(raw, "percent", key, 1), windowDays: num(raw, "windowDays", key, 1) };
}

/** Item 4: reminder reliability (unconfirmed-dose follow-up, self-test timing, iPhone limits). Registry key medicines.reminder_reliability. */
export function loadReminderReliability(asOf?: string): ReminderReliabilityConfig {
  const key = "medicines.reminder_reliability";
  const { raw } = obj(key, asOf);
  const flag = raw["iosTimeSensitive"];
  if (typeof flag !== "boolean") throw new Error(`Config ${key}.iosTimeSensitive must be true or false`);
  return {
    unconfirmedFollowUpMinutes: num(raw, "unconfirmedFollowUpMinutes", key),
    maxUnconfirmedFollowUpsPerDose: num(raw, "maxUnconfirmedFollowUpsPerDose", key),
    selfTestDelaySeconds: num(raw, "selfTestDelaySeconds", key, 1),
    selfTestAnswerWindowSeconds: num(raw, "selfTestAnswerWindowSeconds", key),
    selfTestStaleDays: num(raw, "selfTestStaleDays", key, 1),
    iosPendingLimit: num(raw, "iosPendingLimit", key, 1),
    iosTimeSensitive: flag,
  };
}

/** Item 9: the runway bar and the stock answer's maximum age. Registry key medicines.runway_and_stock_freshness. */
export function loadRunwayConfig(asOf?: string): RunwayConfig {
  const key = "medicines.runway_and_stock_freshness";
  const { raw } = obj(key, asOf);
  return {
    barFullDays: num(raw, "barFullDays", key, 1),
    offerCollectBelowDays: num(raw, "offerCollectBelowDays", key),
    lowSupplyDays: num(raw, "lowSupplyDays", key, 1),
    maxStockAgeHours: num(raw, "maxStockAgeHours", key, 1),
  };
}

/** Item 14: the NAFDAC helper values (registration check address, message number marked unverified). Registry key medicines.nafdac_verify_helper. */
export function loadNafdacHelperConfig(asOf?: string): NafdacHelperConfig {
  const key = "medicines.nafdac_verify_helper";
  const { raw } = obj(key, asOf);
  const reg = raw["registrationCheck"] as Raw | undefined;
  const mas = raw["mas"] as Raw | undefined;
  if (!reg || !mas || typeof reg["url"] !== "string" || typeof reg["name"] !== "string" || typeof mas["shortCode"] !== "string" || typeof mas["verified"] !== "boolean") {
    throw new Error(`Config ${key} is malformed`);
  }
  return {
    registrationCheck: { name: reg["name"], url: reg["url"], readOn: String(reg["readOn"] ?? "") },
    mas: { shortCode: mas["shortCode"], verified: mas["verified"], source: String(mas["source"] ?? ""), codeDigits: num(mas, "codeDigits", key, 1) },
  };
}
