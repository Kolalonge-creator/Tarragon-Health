import { checkObservation, observationRangeMessageKey, type ObservationLimitKey } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";
import type { VitalReadingPayload } from "./api";
import { parseStrictNumber } from "./vitals-entry";

/**
 * S47a (BUILD-SPEC-v5 4.2, 4.3, 6.6): entry checks for water, sleep, mood and the inhaler log on the quick-log sheet. Same stance as vitals-entry.ts:
 * the limits come from the versioned config (observations.plausibility), a refused number gets one plain sentence that says what to check, and a
 * number that is only unusual asks for a second tap (`warn`) and is never refused. Pure, so it is unit tested.
 */
export type LifestyleKind = "water_ml" | "sleep_hours" | "mood" | "inhaler_use";
export const LIFESTYLE_KINDS: readonly LifestyleKind[] = ["water_ml", "sleep_hours", "mood", "inhaler_use"];

export const INHALER_REASONS = ["breathless_or_wheeze", "before_exercise", "routine_dose", "night_symptoms", "other"] as const;
export type InhalerReason = (typeof INHALER_REASONS)[number];

export type LifestyleEntryResult =
  | { ok: true; payload: Extract<VitalReadingPayload, { vital_type: LifestyleKind }>; warn: MessageKey | null }
  | { ok: false; errorKey: MessageKey };

const LIMIT_KEY: Record<LifestyleKind, ObservationLimitKey> = {
  water_ml: "water_ml",
  sleep_hours: "sleep_hours",
  mood: "mood",
  inhaler_use: "inhaler_puffs",
};

const WARN_KEY: Partial<Record<ObservationLimitKey, { unusually_low?: MessageKey; unusually_high?: MessageKey }>> = {
  water_ml: { unusually_high: "observation.confirm.water_ml_high" },
  sleep_hours: { unusually_low: "observation.confirm.sleep_hours_low", unusually_high: "observation.confirm.sleep_hours_high" },
  inhaler_puffs: { unusually_high: "observation.confirm.inhaler_puffs_high" },
};

export function buildLifestyleEntry(kind: LifestyleKind, raw: string, reason?: InhalerReason | null): LifestyleEntryResult {
  const value = parseStrictNumber(raw);
  if (value === null) return { ok: false, errorKey: "vitals.other.error.number" };
  const limitKey = LIMIT_KEY[kind];
  const check = checkObservation(limitKey, value);
  if (!check.ok) return { ok: false, errorKey: observationRangeMessageKey(limitKey) as MessageKey };
  const warn = check.warn ? (WARN_KEY[limitKey]?.[check.warn] ?? null) : null;
  switch (kind) {
    case "water_ml":
      return { ok: true, payload: { vital_type: "water_ml", water_ml: value }, warn };
    case "sleep_hours":
      return { ok: true, payload: { vital_type: "sleep_hours", sleep_hours: value }, warn };
    case "mood":
      return { ok: true, payload: { vital_type: "mood", mood: value }, warn };
    case "inhaler_use":
      // a reason is required: puffs alone cannot tell the care team whether this was a routine dose or a rescue
      if (!reason) return { ok: false, errorKey: "observation.inhaler.reason_required" };
      return { ok: true, payload: { vital_type: "inhaler_use", puffs: value, reason }, warn };
  }
}
