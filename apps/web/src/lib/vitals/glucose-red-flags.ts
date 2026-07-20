/**
 * Diabetes pathway §15.1 / §15.3 / §16 — the glucose & ketone red-flag ruleset,
 * as a PURE function so it is unit-testable without a database and stays the
 * single source of truth for the thresholds. assess-glucose.ts feeds it the
 * patient's recent readings and acts on the result (emergency_events for the
 * two emergency tiers, a clinician_alert for the rest).
 *
 * Design rules baked in from the pathway:
 *  • "When in doubt, treat as a red flag" — bands are chosen to over-, never
 *    under-, escalate (a mild hypo is same-day, not 72h).
 *  • The engine never reassures — a `none` result means "no red flag", not
 *    "you're fine" (that statement is a doctor act, §22).
 *  • A single dangerous value is meaningful on its own (unlike a single pulse),
 *    so acute flags fire on the latest reading; pattern flags need a window.
 *  • KETONES ARE OPTIONAL. Most Nigerian patients cannot test ketones at home
 *    (blood meter or urine strips), so detection is driven by GLUCOSE alone —
 *    a high glucose flags the doctor regardless of whether ketones were logged.
 *    Ketones, when present, only ESCALATE a high glucose to the DKA-emergency
 *    tier; their absence never downgrades or suppresses a glucose flag. When a
 *    high glucose has no ketone data, the doctor is asked to contact the
 *    patient, confirm symptoms, and guide them on ketone testing / management.
 */

/** mmol/L thresholds (WHO / FMOH, §15.1, §9). */
export const GLUCOSE_THRESHOLDS = {
  severeHypo: 3.0, // < 3.0 → emergency
  hypoAlert: 3.9, // 3.0–3.8 → same-day
  highForDka: 11.0, // glucose this high + ketones → DKA
  veryHigh: 20.0, // ≥ 20 → urgent, screen for DKA/HHS
  persistentHigh: 14.0, // repeated > 14 → uncontrolled
  ketoneHigh: 3.0, // blood ketones ≥ 3.0 → DKA workflow
  ketoneModerate: 1.5, // blood ketones 1.5–2.9 → review
} as const;

export const PERSISTENT_HIGH_MIN_COUNT = 3;
export const RECURRENT_HYPO_MIN_COUNT = 2;

export type KetoneUrineBand = "negative" | "trace" | "small" | "moderate" | "large";

/** urine bands that behave like "high ketones" vs "moderate ketones". */
const URINE_HIGH: KetoneUrineBand[] = ["moderate", "large"];
const URINE_MODERATE: KetoneUrineBand[] = ["small"];

export type GlucoseFlagTier = "emergency" | "urgent" | "amber" | "none";

export type GlucoseFlagKind =
  | "severe_hypo"
  | "suspected_dka"
  | "very_high"
  | "hypo_alert"
  | "ketones_raised"
  | "persistent_hyperglycaemia"
  | "recurrent_hypo"
  | "ketones_moderate"
  | "none";

export interface GlucoseFlag {
  tier: GlucoseFlagTier;
  kind: GlucoseFlagKind;
  /** Short clinician-facing summary written to the alert / event. */
  detail: string;
}

export interface GlucoseAssessmentInput {
  /** Most recent glucose reading, mmol/L (null if none logged). */
  latestGlucose: number | null;
  /** Most recent blood ketone reading, mmol/L (null if none). */
  latestKetoneMmol: number | null;
  /** Most recent urine ketone band (null if none). */
  latestKetoneUrine: KetoneUrineBand | null;
  /** Glucose values (mmol/L) over the trailing pattern window (newest-first ok). */
  recentGlucose: number[];
}

const NONE: GlucoseFlag = { tier: "none", kind: "none", detail: "" };

/**
 * Suspected type 1 / ketosis-prone clue (§4): a young, lean patient with
 * marked hyperglycaemia must not be assumed to be type 2 — getting this wrong
 * (delaying insulin) can be fatal. We err toward suspicion per the pathway: an
 * unknown BMI does not rule it out in a young patient. This only ANNOTATES an
 * already-firing high-glucose flag — it never changes the tier.
 */
export function suspectsType1(opts: { ageYears: number | null; bmi: number | null }): boolean {
  return opts.ageYears !== null && opts.ageYears < 40 && (opts.bmi === null || opts.bmi < 25);
}

/** Flag kinds that describe hyperglycaemia (where a type-1 clue is relevant). */
export const HYPERGLYCAEMIA_KINDS: GlucoseFlagKind[] = [
  "suspected_dka",
  "very_high",
  "persistent_hyperglycaemia",
];

function ketonesHigh(mmol: number | null, urine: KetoneUrineBand | null): boolean {
  return (mmol !== null && mmol >= GLUCOSE_THRESHOLDS.ketoneHigh) || (urine !== null && URINE_HIGH.includes(urine));
}

function ketonesModerate(mmol: number | null, urine: KetoneUrineBand | null): boolean {
  return (
    (mmol !== null && mmol >= GLUCOSE_THRESHOLDS.ketoneModerate && mmol < GLUCOSE_THRESHOLDS.ketoneHigh) ||
    (urine !== null && URINE_MODERATE.includes(urine))
  );
}

export interface GlucoseClassifyOptions {
  /**
   * Per-patient override for the amber "persistent hyperglycaemia" threshold
   * (§9 individualised targets). ONLY the amber band may be relaxed — the
   * emergency and hypo thresholds are fixed and never take an override.
   */
  persistentHighThreshold?: number;
}

/**
 * Returns the single highest-severity red flag across the current glucose +
 * ketone picture, or `none`. One reading can trip several bands; we surface the
 * most severe so the care team gets one clear, correctly-prioritised signal.
 */
export function classifyGlucose(
  input: GlucoseAssessmentInput,
  opts: GlucoseClassifyOptions = {},
): GlucoseFlag {
  const { latestGlucose, latestKetoneMmol, latestKetoneUrine, recentGlucose } = input;
  const g = latestGlucose;
  const ketHigh = ketonesHigh(latestKetoneMmol, latestKetoneUrine);
  const ketMod = ketonesModerate(latestKetoneMmol, latestKetoneUrine);

  // ── EMERGENCY ──────────────────────────────────────────────────────────
  if (g !== null && g < GLUCOSE_THRESHOLDS.severeHypo) {
    return {
      tier: "emergency",
      kind: "severe_hypo",
      detail: `Severe hypoglycaemia — glucose ${g} mmol/L (< ${GLUCOSE_THRESHOLDS.severeHypo}). Treat as an emergency (§17.1): if the patient is confused or cannot swallow, nothing by mouth — emergency care now.`,
    };
  }
  if (g !== null && g >= GLUCOSE_THRESHOLDS.highForDka && ketHigh) {
    return {
      tier: "emergency",
      kind: "suspected_dka",
      detail: `Suspected DKA — glucose ${g} mmol/L with raised ketones. Emergency (§17.2): hospital now, do not delay, never stop insulin.`,
    };
  }

  // ── URGENT (same-day) ────────────────────────────────────────────────────
  if (g !== null && g >= 3.0 && g < GLUCOSE_THRESHOLDS.hypoAlert) {
    return {
      tier: "urgent",
      kind: "hypo_alert",
      detail: `Hypoglycaemia — glucose ${g} mmol/L. 15/15 rule now (§12.6); same-day doctor review of glucose-lowering drugs / insulin.`,
    };
  }
  if (g !== null && g >= GLUCOSE_THRESHOLDS.veryHigh) {
    return {
      tier: "urgent",
      kind: "very_high",
      detail: `Very high glucose — ${g} mmol/L${latestKetoneMmol === null && latestKetoneUrine === null ? " (no ketone reading — patient may not have home ketone testing)" : ""}. Same-day: contact the patient to confirm DKA/HHS symptoms (vomiting, abdominal pain, deep/rapid breathing, drowsiness, marked thirst) and guide them on where/how to test ketones and get further management (§15.1, §17).`,
    };
  }
  if (ketHigh) {
    return {
      tier: "urgent",
      kind: "ketones_raised",
      detail: `Raised ketones${latestKetoneMmol !== null ? ` (${latestKetoneMmol} mmol/L)` : latestKetoneUrine ? ` (urine ${latestKetoneUrine})` : ""}. DKA workflow — urgent doctor, do not delay (§15.3).`,
    };
  }

  // ── AMBER (pattern / routine review) ─────────────────────────────────────
  // Persistent-high threshold may be relaxed per the patient's individual
  // target (never below the guideline default — relax-only).
  const persistentHigh = Math.max(GLUCOSE_THRESHOLDS.persistentHigh, opts.persistentHighThreshold ?? 0);
  const highCount = recentGlucose.filter((v) => v > persistentHigh).length;
  if (highCount >= PERSISTENT_HIGH_MIN_COUNT) {
    return {
      tier: "amber",
      kind: "persistent_hyperglycaemia",
      detail: `Persistent hyperglycaemia — ${highCount} readings > ${persistentHigh} mmol/L recently. Priority review; consider therapy change (§15.1).`,
    };
  }
  const lowCount = recentGlucose.filter((v) => v < GLUCOSE_THRESHOLDS.hypoAlert).length;
  if (lowCount >= RECURRENT_HYPO_MIN_COUNT) {
    return {
      tier: "amber",
      kind: "recurrent_hypo",
      detail: `Recurrent hypoglycaemia — ${lowCount} lows recently. Review for hypo unawareness; consider relaxing targets / adjusting therapy (§15.1).`,
    };
  }
  if (ketMod) {
    return {
      tier: "amber",
      kind: "ketones_moderate",
      detail: `Moderate ketones${latestKetoneMmol !== null ? ` (${latestKetoneMmol} mmol/L)` : latestKetoneUrine ? ` (urine ${latestKetoneUrine})` : ""}. Review; recheck and watch for DKA features (§15.3).`,
    };
  }

  return NONE;
}
