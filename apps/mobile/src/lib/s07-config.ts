import { getProposedConfig } from "@tarragon/shared";

/**
 * Typed loaders for the S07 values in the versioned registry
 * (packages/shared/src/proposed-config). Every number here is a proposal for the
 * Chief Medical Officer or founder to confirm, so call sites take a config
 * object and never a literal. Each loader validates the shape it reads, so a
 * malformed registry entry fails loudly in a test, not silently on a phone.
 *
 * Known limit (recorded in the S07 PR): these values ship inside the app. When
 * the Chief Medical Officer confirms or changes one, installed phones only pick
 * it up with the next build or OTA update. S06 chose a server table for its
 * equivalent values (offline-sync-config.ts); moving these reads to a
 * server-synced config is a follow-up decision, not made here.
 */
export interface HomeProtocolConfig {
  version: number;
  readingsPerSession: number;
  minGapMinutes: number;
  targetDays: number;
  restMinutes: number;
  /** Local hour range [start, end), end 24 meaning midnight. */
  morningHours: readonly [number, number];
  eveningHours: readonly [number, number];
}

export interface AverageGateRule {
  minReadings: number;
  minDays: number;
  minPerDay: number;
}

export interface AverageGateConfig {
  version: number;
  windowDays: number;
  rules: readonly AverageGateRule[];
}

export interface TrendDisplayConfig {
  version: number;
  minReadingsForChart: number;
  gapBreakDays: number;
}

export interface StartingSuggestionTarget {
  version: number;
  systolicBelow: number;
  diastolicBelow: number;
}

export interface ReminderBehaviourConfig {
  version: number;
  snoozeMinutes: number;
  maxSnoozes: number;
  missedAfterMinutes: number;
  /** Medicine reminders (S08). */
  maxPending: number;
  /** Blood pressure reminders (S07). maxPending + maxPendingBp stays under the phone's 64. */
  maxPendingBp: number;
  horizonDays: number;
}

export interface StreakRulesConfig {
  version: number;
  freezeEarnEveryDays: number;
  freezeCap: number;
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

function hours(raw: Raw, field: string, key: string): readonly [number, number] {
  const v = raw[field];
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    typeof v[0] !== "number" ||
    typeof v[1] !== "number" ||
    v[0] < 0 ||
    v[1] > 24 ||
    v[0] >= v[1]
  ) {
    throw new Error(`Config ${key}.${field} must be [startHour, endHour) within 0..24`);
  }
  return [v[0], v[1]];
}

export function loadHomeProtocol(asOf?: string): HomeProtocolConfig {
  const key = "bp.home_protocol";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    readingsPerSession: num(raw, "readingsPerSession", key, 1),
    minGapMinutes: num(raw, "minGapMinutes", key),
    targetDays: num(raw, "targetDays", key, 1),
    restMinutes: num(raw, "restMinutes", key),
    morningHours: hours(raw, "morningHours", key),
    eveningHours: hours(raw, "eveningHours", key),
  };
}

export function loadAverageGate(asOf?: string): AverageGateConfig {
  const key = "bp.average_gate";
  const { raw, version } = obj(key, asOf);
  const rules = raw.rules;
  if (!Array.isArray(rules) || rules.length === 0) throw new Error(`Config ${key}.rules must be a non-empty list`);
  return {
    version,
    windowDays: num(raw, "windowDays", key, 1),
    rules: rules.map((r, i) => {
      const rr = r as Raw;
      const path = `${key}.rules[${i}]`;
      return {
        minReadings: num(rr, "minReadings", path, 1),
        minDays: num(rr, "minDays", path, 1),
        minPerDay: num(rr, "minPerDay", path, 1),
      };
    }),
  };
}

export function loadTrendDisplay(asOf?: string): TrendDisplayConfig {
  const key = "bp.trend_display";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    minReadingsForChart: num(raw, "minReadingsForChart", key, 1),
    gapBreakDays: num(raw, "gapBreakDays", key, 1),
  };
}

export function loadStartingSuggestionTarget(asOf?: string): StartingSuggestionTarget {
  const key = "bp.starting_suggestion_target";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    systolicBelow: num(raw, "systolicBelow", key, 1),
    diastolicBelow: num(raw, "diastolicBelow", key, 1),
  };
}

export function loadReminderBehaviour(asOf?: string): ReminderBehaviourConfig {
  const key = "reminders.behaviour";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    snoozeMinutes: num(raw, "snoozeMinutes", key, 1),
    maxSnoozes: num(raw, "maxSnoozes", key),
    missedAfterMinutes: num(raw, "missedAfterMinutes", key, 1),
    maxPending: num(raw, "maxPending", key, 1),
    maxPendingBp: num(raw, "maxPendingBp", key, 1),
    horizonDays: num(raw, "horizonDays", key, 1),
  };
}

export function loadStreakRules(asOf?: string): StreakRulesConfig {
  const key = "streaks.rules";
  const { raw, version } = obj(key, asOf);
  return {
    version,
    freezeEarnEveryDays: num(raw, "freezeEarnEveryDays", key, 1),
    freezeCap: num(raw, "freezeCap", key),
  };
}
