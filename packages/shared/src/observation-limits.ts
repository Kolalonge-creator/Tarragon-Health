import { getProposedConfig, UnknownConfigKeyError } from "./proposed-config";
import type { ObservationLimitKey } from "./proposed-config/observation-limits-data";

export type { ObservationLimitKey } from "./proposed-config/observation-limits-data";

export interface ObservationLimit {
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly integer: boolean;
  readonly softMin?: number;
  readonly softMax?: number;
}

/** The limit in force for one observation (S47a, config key observations.plausibility). Throws on an unknown key, never "no limit". */
export function observationLimit(key: ObservationLimitKey): ObservationLimit {
  // A phone with a clock set before the config's effective date must still have a limit (a typo gate that throws at import would crash the
  // screen), so an unresolved date falls back to the latest version rather than to "no limit".
  let resolved;
  try {
    resolved = getProposedConfig("observations.plausibility");
  } catch (e) {
    if (!(e instanceof UnknownConfigKeyError)) throw e;
    resolved = getProposedConfig("observations.plausibility", "9999-12-31");
  }
  const all = resolved.value as unknown as Record<string, ObservationLimit>;
  const hit = all[key];
  if (!hit) throw new Error(`No plausibility limit for ${key}`);
  return hit;
}

export type ObservationCheck =
  | {
      ok: true;
      /** The number is allowed but unusual: ask the person to confirm it, never refuse it. */
      warn: "unusually_low" | "unusually_high" | null;
    }
  | { ok: false; reason: "not_a_number" | "out_of_range" | "not_whole" };

/**
 * One plausibility check for one number. Pure, so the phone, the web form and the API all give the same answer.
 * Deliberately says nothing about clinical meaning: a dangerous reading inside the hard limits is accepted and goes to the red-flag engines.
 */
export function checkObservation(key: ObservationLimitKey, value: number): ObservationCheck {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  const l = observationLimit(key);
  if (value < l.min || value > l.max) return { ok: false, reason: "out_of_range" };
  if (l.integer && !Number.isInteger(value)) return { ok: false, reason: "not_whole" };
  if (l.softMin !== undefined && value < l.softMin) return { ok: true, warn: "unusually_low" };
  if (l.softMax !== undefined && value > l.softMax) return { ok: true, warn: "unusually_high" };
  return { ok: true, warn: null };
}

/** The translation key (packages/i18n) for the plain sentence shown when a number is refused. */
export function observationRangeMessageKey(key: ObservationLimitKey): `observation.range.${ObservationLimitKey}` {
  return `observation.range.${key}`;
}
