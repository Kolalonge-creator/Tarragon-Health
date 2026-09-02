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

/** mmol/L thresholds (WHO / FMOH). Overridable via threshold-sync.ts's
 * loadActiveThresholds() if the server reports a newer version. */
export const GLUCOSE_THRESHOLDS = {
  severeHypo: 3.0,
  hypoAlert: 3.9,
  highForDka: 11.0,
  veryHigh: 20.0,
  persistentHigh: 14.0,
  ketoneHigh: 3.0,
  ketoneModerate: 1.5,
} as const;

export type GlucoseThresholds = typeof GLUCOSE_THRESHOLDS;

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
  thresholds: GlucoseThresholds = GLUCOSE_THRESHOLDS
): GlucoseFlag {
  const ketHigh = ketoneMmol !== null && ketoneMmol >= thresholds.ketoneHigh;

  if (glucose < thresholds.severeHypo) {
    return {
      tier: "emergency",
      kind: "severe_hypo",
      detail: `Severe hypoglycaemia — glucose ${glucose} mmol/L (< ${thresholds.severeHypo}).`,
    };
  }
  if (glucose >= thresholds.highForDka && ketHigh) {
    return {
      tier: "emergency",
      kind: "suspected_dka",
      detail: `Suspected DKA — glucose ${glucose} mmol/L with raised ketones.`,
    };
  }
  if (glucose >= thresholds.severeHypo && glucose < thresholds.hypoAlert) {
    return {
      tier: "urgent",
      kind: "hypo_alert",
      detail: `Hypoglycaemia — glucose ${glucose} mmol/L.`,
    };
  }
  if (glucose >= thresholds.veryHigh) {
    return {
      tier: "urgent",
      kind: "very_high",
      detail: `Very high glucose — ${glucose} mmol/L.`,
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
