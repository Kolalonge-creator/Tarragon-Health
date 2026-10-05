/**
 * INV-07 (spec section 2): a notification never names a condition, reading or result. Pure code, no Deno or Node
 * globals, so the edge sender, the Jest lint and the settings screens read one definition. The term list is
 * DATA (`FORBIDDEN_TERMS_VERSION` names the revision); the database keeps the same list in
 * `notification_forbidden_terms` and a test fails if the two drift.
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

/** True when the payload carries a forbidden key; used by tests and by the sender's log line. */
export function forbiddenPayloadKeys(payload: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(payload).filter((k) => FORBIDDEN_PARAM_KEYS.includes(k));
}

/**
 * Renders a template with every payload key set to a unique canary and reports any forbidden key whose canary
 * reached the output, plus term violations in the fixed wording. This is what the lint test runs over every
 * template function, so a render function that interpolates `payload.drug_name` is caught even though its source
 * is code, not text.
 */
export function lintRenderFn(
  render: (payload: Record<string, unknown>) => { smsText: string; email?: { subject: string; html: string; text?: string } },
  keys: readonly string[] = FORBIDDEN_PARAM_KEYS,
): Violation[] {
  const canary = (k: string): string => `ZQ${k.replace(/_/g, "")}QZ`;
  // Every key reads back its own canary, so a template cannot reach a clinical key the test did not think of.
  const payload = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (typeof k === "string" ? canary(k) : undefined),
  });
  const out: Violation[] = [];
  let r;
  try {
    r = render(payload);
  } catch (e) {
    return [{ kind: "unrenderable", match: String(e).slice(0, 80) }];
  }
  const texts = [r.smsText, r.email?.subject ?? "", r.email?.text ?? "", r.email?.html ?? ""];
  for (const t of texts) {
    for (const k of keys) if (t.includes(canary(k))) out.push({ kind: "param", match: k });
    const fixed = t.replace(/ZQ[a-z0-9]+QZ/gi, " ");
    out.push(...lintText(fixed).filter((v) => v.kind !== "param"));
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    const id = `${v.kind}:${v.match.toLowerCase()}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The `kind:match` strings a caller stores and logs, from either lint entry point. */
export const describeViolations = (v: readonly Violation[]): string[] => v.map((x) => `${x.kind}:${x.match}`);
