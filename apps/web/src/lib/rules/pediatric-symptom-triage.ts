/**
 * Paediatric symptom red-flag classification (Child Health Platform §48.8/§48.9:
 * "Paediatric triage must not simply reuse adult rules").
 *
 * PURE mirror of private.handle_symptom_red_flag()'s paediatric branch
 * (20260829122452_pediatric_symptom_and_vitals_red_flags.sql) — the database
 * trigger is the actual enforcement point (it fires on every insert path and
 * cannot be bypassed), this function exists so the app can show the same
 * verdict immediately in the UI and so the rule is unit-testable in one place.
 * If the two ever disagree, the migration is the one to trust — this is a
 * client-side preview, never the source of truth.
 */

export const PAEDIATRIC_SYMPTOM_TYPES = [
  "poor_feeding",
  "lethargy",
  "grunting_or_retractions",
  "dehydration_signs",
] as const;
export type PaediatricSymptomType = (typeof PAEDIATRIC_SYMPTOM_TYPES)[number];

export const PAEDIATRIC_SYMPTOM_LABEL: Record<PaediatricSymptomType, string> = {
  poor_feeding: "Feeding much less than usual, or refusing to feed",
  lethargy: "Unusually sleepy, floppy, or hard to wake",
  grunting_or_retractions: "Grunting, or the chest pulling in with each breath",
  dehydration_signs: "Fewer wet nappies, dry mouth, or no tears when crying",
};

const LOW_THRESHOLD_ADULT_TYPES = new Set([
  "breathlessness",
  "palpitations",
  "swelling",
  "chest_pain",
  "severe_headache",
  "visual_disturbance",
  "confusion",
]);

export interface PaediatricTriageInput {
  symptomType: string;
  severity: number;
  ageYears: number | null;
}

export type TriageOutcome = "emergency" | "clinician_review" | "none";

/**
 * The bar for the four paediatric-only symptom types is lower than the adult
 * low-threshold bucket (severity >= 4 rather than >= 6, and only for a
 * child under 5) — lethargy or poor feeding at even moderate self-rated
 * severity in a young child is a materially different picture than an
 * adult reporting mild fatigue. Every other symptom type/age combination is
 * completely unchanged from the existing adult rule.
 */
export function classifyPaediatricSymptom(input: PaediatricTriageInput): TriageOutcome {
  const { symptomType, severity, ageYears } = input;

  if (severity >= 8) return "emergency";
  if (LOW_THRESHOLD_ADULT_TYPES.has(symptomType) && severity >= 6) return "emergency";
  if (
    ageYears !== null &&
    ageYears < 5 &&
    (PAEDIATRIC_SYMPTOM_TYPES as readonly string[]).includes(symptomType) &&
    severity >= 4
  ) {
    return "emergency";
  }
  if (severity >= 5) return "clinician_review";
  return "none";
}

/** Whether the paediatric-only symptom options should be offered at all —
 * they describe findings that only make clinical sense for a young child. */
export function shouldOfferPaediatricSymptomTypes(ageYears: number | null): boolean {
  return ageYears !== null && ageYears < 5;
}
