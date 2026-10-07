/**
 * What we already know about the person (spec 12.2, 12.6), used to TIGHTEN urgency and never to loosen it.
 *
 * The inputs are age, sex, pregnancy, known conditions, medicines and recent readings from the health record. They do not decide
 * a category. The only thing a context entry can do is name a MINIMUM category, so the result is
 * `mostUrgentCategory(current, minimum)`, which is by construction never less urgent than `current`. There is no field that
 * sets, lowers or replaces a category, the schema is strict, and `context-tightening.test.ts` proves over many random contexts
 * that adding or changing any input never lowers a result (the "extra inputs never lower urgency" property).
 *
 * SIGN-OFF. As with the prevalence layer (`risk-tightening.ts`), an entry applies only when it carries a recorded clinical
 * sign-off. Everything in the shipped config is a DRAFT, so the layer is inert until the CMO signs a version. This module never
 * signs anything and carries no numbers of its own: a reading threshold is a value inside a config entry, not a constant here.
 *
 * Pure and deterministic (INV-01). Nothing here reads a database, the network or a model.
 */
import { z } from "zod";
import { TRIAGE_CATEGORIES, mostUrgentCategory, type SymptomCapture, type TriageCategory } from "../types/index";

const categorySchema = z.enum(TRIAGE_CATEGORIES);

/** The readings the health record can supply, by the key the config names. */
export const READING_KEYS = ["systolic", "diastolic", "spo2_pct", "glucose_mmol_l", "temperature_c", "pulse_bpm"] as const;
export type ReadingKey = (typeof READING_KEYS)[number];
const readingKeySchema = z.enum(READING_KEYS);

export interface ClinicalContext {
  /** Whole years, or null when the date of birth is not on record. */
  ageYears: number | null;
  sex: "female" | "male" | null;
  /** true / false when recorded, null when unknown. Unknown never counts as pregnant, and never as not pregnant either. */
  pregnant: boolean | null;
  /** Lower-cased condition names from the record. */
  conditions: string[];
  /** Lower-cased medicine names from the record. */
  medicines: string[];
  /** The most recent value of each reading inside the look-back window, when there is one. */
  readings: Partial<Record<ReadingKey, number>>;
}

export const EMPTY_CONTEXT: ClinicalContext = Object.freeze({ ageYears: null, sex: null, pregnant: null, conditions: [], medicines: [], readings: {} });

export const contextEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    provenance: z.object({ source: z.string().min(1), note: z.string().min(1) }).strict(),
    status: z.enum(["draft", "signed_off"]),
    clinical_sign_off: z.object({ by: z.string().min(1), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().nullable(),
    applies_when: z
      .object({
        /** Whole years, inclusive. A person whose age is unknown never matches (an input can only add a match, never remove one). */
        age_min: z.number().int().min(0).max(150).optional(),
        age_max: z.number().int().min(0).max(150).optional(),
        sex: z.enum(["female", "male"]).optional(),
        /** true means "known pregnant, or ticked pregnant in this check". Unknown does not match. */
        pregnant: z.literal(true).optional(),
        any_condition: z.array(z.string().min(1)).min(1).optional(),
        any_medicine: z.array(z.string().min(1)).min(1).optional(),
        /** A symptom the person ticked in this check (for example a general danger sign in a young child). */
        any_associated_symptom: z.array(z.string().min(1)).min(1).optional(),
        reading_at_least: z.object({ key: readingKeySchema, value: z.number() }).strict().optional(),
        reading_at_most: z.object({ key: readingKeySchema, value: z.number() }).strict().optional(),
        complaint_keys: z.array(z.string().min(1)).min(1).optional(),
        min_severity: z.number().int().min(1).max(10).optional(),
      })
      .strict(),
    /** The most this entry can do: raise a result to AT LEAST this category. */
    minimum_category: categorySchema,
  })
  .strict();
export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const contextTighteningConfigSchema = z.object({ entries: z.array(contextEntrySchema) }).strict();
export type ContextTighteningConfig = z.infer<typeof contextTighteningConfigSchema>;

export interface ContextTighteningResult {
  category: TriageCategory;
  raisedBy: string[];
  matchedNoChange: string[];
  /** Which kinds of input were present (names only, never values), for the audit record. */
  inputsPresent: string[];
}

function isInForce(entry: ContextEntry): boolean {
  return entry.status === "signed_off" && entry.clinical_sign_off !== null;
}

function includesAny(haystack: string[], needles: string[]): boolean {
  const hay = haystack.map((h) => h.trim().toLowerCase());
  return needles.some((n) => {
    const needle = n.trim().toLowerCase();
    return hay.some((h) => h === needle || h.includes(needle));
  });
}

export function contextEntryApplies(entry: ContextEntry, ctx: ClinicalContext, capture: SymptomCapture): boolean {
  const w = entry.applies_when;
  // An input only ever ADDS a match: an unknown value never matches, so supplying more of the record can never remove a match
  // that fewer inputs would have had. That is what makes "extra inputs never lower urgency" true by construction.
  if (w.age_min !== undefined && (ctx.ageYears === null || ctx.ageYears < w.age_min)) return false;
  if (w.age_max !== undefined && (ctx.ageYears === null || ctx.ageYears > w.age_max)) return false;
  if (w.sex !== undefined && ctx.sex !== w.sex) return false;
  if (w.pregnant === true && !(ctx.pregnant === true || capture.relevantHistory.includes("pregnant"))) return false;
  if (w.any_condition && !includesAny([...ctx.conditions, ...capture.relevantHistory], w.any_condition)) return false;
  if (w.any_medicine && !includesAny([...ctx.medicines, ...capture.relevantHistory], w.any_medicine)) return false;
  if (w.any_associated_symptom && !includesAny(capture.associatedSymptoms, w.any_associated_symptom)) return false;
  if (w.reading_at_least) {
    const v = ctx.readings[w.reading_at_least.key];
    if (typeof v !== "number" || !(v >= w.reading_at_least.value)) return false;
  }
  if (w.reading_at_most) {
    const v = ctx.readings[w.reading_at_most.key];
    if (typeof v !== "number" || !(v <= w.reading_at_most.value)) return false;
  }
  if (w.complaint_keys && !w.complaint_keys.includes(capture.presentingComplaintKey)) return false;
  if (w.min_severity !== undefined && capture.severity < w.min_severity) return false;
  return true;
}

export function presentInputs(ctx: ClinicalContext): string[] {
  const out: string[] = [];
  if (ctx.ageYears !== null) out.push("age");
  if (ctx.sex !== null) out.push("sex");
  if (ctx.pregnant !== null) out.push("pregnancy");
  if (ctx.conditions.length > 0) out.push("conditions");
  if (ctx.medicines.length > 0) out.push("medicines");
  if (Object.keys(ctx.readings).length > 0) out.push("readings");
  return out;
}

/** Raise `current` to at least the minimum of every signed, matching entry. Never lowers. A malformed config applies nothing. */
export function applyContextTightening(
  current: TriageCategory,
  ctx: ClinicalContext,
  capture: SymptomCapture,
  rawConfig: unknown,
): ContextTighteningResult {
  const inputsPresent = presentInputs(ctx);
  const parsed = contextTighteningConfigSchema.safeParse(rawConfig);
  if (!parsed.success) return { category: current, raisedBy: [], matchedNoChange: [], inputsPresent };
  let category = current;
  const raisedBy: string[] = [];
  const matchedNoChange: string[] = [];
  for (const entry of parsed.data.entries) {
    if (!isInForce(entry) || !contextEntryApplies(entry, ctx, capture)) continue;
    const next = mostUrgentCategory(category, entry.minimum_category);
    if (next !== category) {
      category = next;
      raisedBy.push(entry.id);
    } else {
      matchedNoChange.push(entry.id);
    }
  }
  return { category, raisedBy, matchedNoChange, inputsPresent };
}
