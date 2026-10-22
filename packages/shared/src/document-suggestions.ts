import { z } from "zod";

/**
 * Photo capture of a paper health document (S43, spec 2.3): the pure half.
 *
 * A reader (a vision model, see extract.ts) turns a photo into SUGGESTIONS. A
 * suggestion is never part of the record: it lives in
 * patient_documents.extracted until the patient confirms it, one field at a
 * time, and a rejected reading is erased down to nothing but the original
 * photo. Nothing in this file talks to a database or a model, so the rules
 * that keep suggestions out of the record can be tested without either.
 *
 * Mirrors the database: record_document_suggestion normalises the same way
 * (key and value required, value at most 400 characters, at most 80 fields,
 * every suggestion starts as "suggested", confidence one of low/medium/high),
 * and confirm_document_extraction keeps only fields the patient accepted.
 */

export const MAX_SUGGESTED_FIELDS = 80;
export const MAX_FIELD_VALUE_LENGTH = 400;

export const DOCUMENT_CAPTURE_TYPES = [
  "discharge_summary",
  "prescription",
  "vaccination_card",
  "specialist_letter",
  "previous_hospital_record",
  "other",
] as const;
export type DocumentCaptureType = (typeof DOCUMENT_CAPTURE_TYPES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type SuggestionConfidence = (typeof CONFIDENCE_LEVELS)[number];

/** What the reader is asked to return, before any validation of our own. */
export const rawCaptureSchema = z.object({
  /** The full text of the page as printed, for the reader's own audit. Dropped when the patient confirms. */
  ocr_text: z.string(),
  fields: z.array(
    z.object({
      /** What the printed label says, copied as printed (for example "Haemoglobin"). */
      label: z.string(),
      /** The printed value exactly as written, never interpreted or converted. */
      value: z.string(),
      unit: z.string().nullable().optional(),
      confidence: z.enum(CONFIDENCE_LEVELS),
    })
  ),
  /** Set when the image is too poor, cropped, or not a health document at all. */
  unreadable_reason: z.string().nullable(),
});
export type RawCapture = z.infer<typeof rawCaptureSchema>;

export interface SuggestedField {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  confidence: SuggestionConfidence;
}

export interface NormalisedSuggestions {
  ocrText: string;
  fields: SuggestedField[];
  unreadableReason: string | null;
}

function slug(label: string): string {
  const s = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.slice(0, 60) || "field";
}

/**
 * Turns the reader's raw output into the suggestions that are stored.
 * Drops empty values and over-long values, caps the count, makes every key
 * unique (a document that prints the same label twice keeps both).
 */
export function normaliseSuggestions(raw: RawCapture): NormalisedSuggestions {
  const used = new Map<string, number>();
  const fields: SuggestedField[] = [];
  for (const f of raw.fields) {
    const label = f.label.trim();
    const value = f.value.trim();
    if (!label || !value || value.length > MAX_FIELD_VALUE_LENGTH) continue;
    if (fields.length >= MAX_SUGGESTED_FIELDS) break;
    const base = slug(label);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    fields.push({
      key: n === 1 ? base : `${base}_${n}`,
      label: label.slice(0, 120),
      value,
      unit: f.unit?.trim() || null,
      confidence: f.confidence,
    });
  }
  return { ocrText: raw.ocr_text.slice(0, 20000), fields, unreadableReason: raw.unreadable_reason?.trim() || null };
}

/** The payload record_document_suggestion takes. The model identifier travels separately. */
export function toSuggestionPayload(n: NormalisedSuggestions): { fields: SuggestedField[]; unreadable_reason: string | null } {
  return { fields: n.fields, unreadable_reason: n.unreadableReason };
}

/** One patient decision per suggested field. `value` is an edit; absent means keep what was read. */
export interface FieldDecision {
  key: string;
  accept: boolean;
  value?: string;
}

export const fieldDecisionsSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(80),
      accept: z.boolean(),
      value: z.string().max(MAX_FIELD_VALUE_LENGTH).optional(),
    })
  )
  .max(MAX_SUGGESTED_FIELDS);

/**
 * What the screen has to say before it lets the patient press "Confirm":
 * at least one field accepted. Everything not accepted is dropped by the
 * database, so the screen states that plainly rather than hiding it.
 */
export function summariseDecisions(fields: readonly SuggestedField[], decisions: readonly FieldDecision[]) {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  let accepted = 0;
  let edited = 0;
  for (const f of fields) {
    const d = byKey.get(f.key);
    if (!d?.accept) continue;
    accepted += 1;
    const v = d.value?.trim();
    if (v && v !== f.value) edited += 1;
  }
  return { accepted, edited, dropped: fields.length - accepted, canConfirm: accepted > 0 };
}

/** Only keys that exist in the suggestion are sent: the database ignores the rest, and a screen should never offer them. */
export function decisionsForRpc(fields: readonly SuggestedField[], decisions: readonly FieldDecision[]): FieldDecision[] {
  const known = new Set(fields.map((f) => f.key));
  return decisions.filter((d) => known.has(d.key));
}
