/**
 * Mirrors apps/web/src/lib/vitals/glucose-red-flags.ts — the pure,
 * deterministic glucose/ketone red-flag classifier, ported here so the
 * native Vitals screen can render "go to the nearest hospital now" guidance
 * instantly, with zero network round-trip, before the reading has even
 * synced (see docs/MOBILE_APP_SPEC.md §6). The authoritative pipeline is
 * still server-side (assessGlucoseBestEffort, run once the reading lands) —
 * this copy exists ONLY to drive the on-device guidance modal, never to
 * create or resolve a clinical record itself. Keep in lock-step with the web
 * copy; threshold-sync.ts fetches a version check so drift doesn't go
 * unnoticed silently.
 */
import { getProposedConfig } from "@tarragon/shared";

/** S61: the numbers are the versioned PROPOSED config entry `diabetes.glucose_thresholds`, the same entry the web classifier and the
 * diabetes pathway rule set are built from (a parity test pins the two copies together). Overridable via threshold-sync.ts's
 * loadActiveThresholds() if the server reports a newer version. */
const GLUCOSE_CONFIG = getProposedConfig<Record<string, number>>("diabetes.glucose_thresholds");
const cfg = (k: string): number => {
  const v = GLUCOSE_CONFIG.value[k];
  if (typeof v !== "number") throw new Error(`diabetes.glucose_thresholds.${k} is not a number`);
  return v;
};
export const GLUCOSE_THRESHOLDS_CONFIG_VERSION = `cfg-v${GLUCOSE_CONFIG.version}`;
export const GLUCOSE_THRESHOLDS = {
  severeHypo: cfg("severeHypo"),
  hypoAlert: cfg("hypoAlert"),
  highForDka: cfg("highForDka"),
  veryHigh: cfg("veryHigh"),
  persistentHigh: cfg("persistentHigh"),
  ketoneHigh: cfg("ketoneHigh"),
  ketoneModerate: cfg("ketoneModerate"),
} as const;

/** Danger events a patient can tick with a reading (decision Q5). Any one at a reading below hypoAlert is an emergency. */
export type GlucoseDangerEvent = "confusion" | "seizure" | "unresponsive" | "needed_help";

/** Structural rather than `typeof GLUCOSE_THRESHOLDS` — see the same note on
 * bp-classification.ts's BpThresholds: the `as const` constant's literal
 * types made the overridable parameter below accept only the bundled values,
 * defeating threshold-sync.ts. */
export type GlucoseThresholds = { -readonly [K in keyof typeof GLUCOSE_THRESHOLDS]: number };

export type GlucoseFlagTier = "emergency" | "urgent" | "amber" | "none";

export type GlucoseFlagKind =
  | "severe_hypo"
  | "suspected_dka"
  | "very_high"
  | "hypo_alert"
  | "ketones_raised"
  | "none";

export interface GlucoseFlag {
  tier: GlucoseFlagTier;
  kind: GlucoseFlagKind;
  detail: string;
}

const NONE: GlucoseFlag = { tier: "none", kind: "none", detail: "" };

/**
 * A single-reading subset of the full server-side classifier — pattern-based
 * bands (persistent hyperglycaemia, recurrent hypo) need a trailing window of
 * readings the phone doesn't have offline, so those stay server-only. This
 * covers every band that can fire on ONE reading, which is exactly the set
 * that needs to render before the app has synced anything.
 */
export function classifyGlucoseOffline(
  glucose: number,
  ketoneMmol: number | null,
  thresholds: GlucoseThresholds = GLUCOSE_THRESHOLDS,
  events: readonly GlucoseDangerEvent[] = [],
): GlucoseFlag {
  const ketHigh = ketoneMmol !== null && ketoneMmol >= thresholds.ketoneHigh;

  if (glucose < thresholds.hypoAlert && events.length > 0) {
    return {
      tier: "emergency",
      kind: "severe_hypo",
      detail: `Severe hypoglycaemia event: glucose ${glucose} mmol/L with a danger symptom.`,
    };
  }

  if (glucose < thresholds.severeHypo) {
    return {
      tier: "emergency",
      kind: "severe_hypo",
      detail: `Severe hypoglycaemia: glucose ${glucose} mmol/L (below ${thresholds.severeHypo}).`,
    };
  }
  if (glucose >= thresholds.highForDka && ketHigh) {
    return {
      tier: "emergency",
      kind: "suspected_dka",
      detail: `Suspected DKA: glucose ${glucose} mmol/L with raised ketones.`,
    };
  }
  if (glucose >= thresholds.severeHypo && glucose < thresholds.hypoAlert) {
    return {
      tier: "urgent",
      kind: "hypo_alert",
      detail: `Hypoglycaemia: glucose ${glucose} mmol/L.`,
    };
  }
  if (glucose >= thresholds.veryHigh) {
    return {
      tier: "urgent",
      kind: "very_high",
      detail: `Very high glucose: ${glucose} mmol/L.`,
    };
  }
  if (ketHigh) {
    return {
      tier: "urgent",
      kind: "ketones_raised",
      detail: `Raised ketones (${ketoneMmol} mmol/L).`,
    };
  }
  return NONE;
}
