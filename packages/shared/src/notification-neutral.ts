/**
 * INV-07 lint for free text, usable from app code (S51, closes OQ-94 for AI-written text). A COPY of
 * supabase/functions/_shared/notifications/neutral.ts (a Deno function cannot import this package and the app cannot import
 * from the functions folder). `notification-neutral.test.ts` fails if the term, param, number or emoji rules drift from the
 * edge copy. Do not edit the lists here without editing the edge copy and `notification_forbidden_terms` in the database.
 */

export const FORBIDDEN_TERMS_VERSION = 1;

/** Whole words or stems (a trailing * is any ending). Lower case. Condition, reading, result and medicine words. */
export const FORBIDDEN_TERMS: readonly string[] = [
  // conditions
  "diabet*", "hypertens*", "blood pressure", "bp", "sugar", "glucose", "glucometer", "cholesterol", "lipid*", "hba1c",
  "a1c", "asthma*", "ckd", "kidney*", "heart*", "cardiac", "cardio*", "stroke", "cancer*", "tumour*", "tumor*", "hiv",
  "hepatitis", "sti", "std", "pregnan*", "fertility", "menstrual", "contracept*", "antenatal", "postnatal", "malaria",
  "tuberculosis", "sickle*", "epilep*", "depress*", "anxiety", "mental", "obes*", "overweight", "pressure",
  // readings and results
  "reading*", "result*", "lab", "labs", "laboratory", "scan", "scans", "x-ray", "ecg", "biopsy", "screening*", "positive",
  "negative", "abnormal", "elevated", "diagnos*", "symptom*", "treatment*",
  // medicines
  "medicine*", "medication*", "drug*", "tablet*", "pill*", "dose*", "dosage*", "prescri*", "refill*", "insulin",
  "metformin", "amlodipine", "lisinopril", "losartan", "statin*", "antibiotic*", "vaccin*", "inhaler*",
];

/** Parameter names that carry clinical content. A template may never read one, and a push or email may never carry one. */
export const FORBIDDEN_PARAM_KEYS: readonly string[] = [
  "drug_name", "drug", "medicine", "medication", "medication_name", "condition", "condition_label", "diagnosis",
  "reading", "value", "systolic", "diastolic", "glucose", "test_name", "result", "result_text", "vaccine_name",
  "screening_name", "symptom", "details",
  // Added after the first review: payload keys the sender templates read whose values are clinical.
  "suggested_vital_type", "vital_type", "vital_label", "level_label", "signal_label", "screen_type_name", "bundle_name",
  "items_summary", "failure_reason", "referral_reason", "specialist_type", "source_label", "service_type", "services",
];

export type ViolationKind = "term" | "number" | "param" | "emoji" | "unrenderable";
export interface Violation { readonly kind: ViolationKind; readonly match: string }

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const termPatterns: readonly RegExp[] = FORBIDDEN_TERMS.map((t) => {
  const stem = t.endsWith("*");
  const body = escapeRegex(stem ? t.slice(0, -1) : t).replace(/\\? /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])(${body}${stem ? "[a-z]*" : ""})(?![a-z0-9])`, "i");
});

// A blood pressure pair (120/80), a number with a clinical unit, or "above/below/over" a bare number.
const numberPatterns: readonly RegExp[] = [
  /\b\d{2,3}\s*\/\s*\d{2,3}\b/,
  /\b\d+(?:[.,]\d+)?\s*(?:mmhg|mg\/dl|mmol\/l|mmol|mg|mcg|ml|bpm|kg)/i,
];

// Emoji that hint at a body part or a condition.
const emojiPattern = /[\u{1F489}\u{1F48A}\u{1FA78}\u{1FA7A}\u{1F9EA}\u{1F9EC}\u{1F9A0}\u{1FAC0}\u{1FAC1}\u{1FA79}\u{2764}\u{1F493}-\u{1F49F}]/u;

/** Placeholder names such as {{drug_name}} in a template body. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] as string);
}

/** Violations in a template body or in already rendered text. Placeholders are checked by name, not by value. */
export function lintText(text: string): Violation[] {
  const out: Violation[] = [];
  for (const key of placeholders(text)) {
    if (FORBIDDEN_PARAM_KEYS.includes(key)) out.push({ kind: "param", match: key });
  }
  const bare = text.replace(/\{\{\s*\w+\s*\}\}/g, " ");
  for (const re of termPatterns) {
    const m = re.exec(bare);
    if (m) out.push({ kind: "term", match: m[2] as string });
  }
  for (const re of numberPatterns) {
    const m = re.exec(bare);
    if (m) out.push({ kind: "number", match: m[0] });
  }
  const e = emojiPattern.exec(bare);
  if (e) out.push({ kind: "emoji", match: e[0] });
  return out;
}

