/**
 * The one place that knows what KIND each `fhir_import_proposed_resources.
 * normalized_payload` field is — number/boolean/date/enum/free-text/
 * read-only-identity. Both the review UI (fhir-review-queue.tsx, to render
 * the right input control) and the modify server action (actions.ts, to
 * coerce a submitted value back correctly) import this instead of each
 * re-deriving the same knowledge independently — closes a /code-review
 * finding: an earlier version had the UI guess a field's kind from
 * `typeof` alone, which correctly caught numbers/booleans but had no way to
 * know `severity`/`glucose_context` are enums (both `typeof === "string"`,
 * same as free text), so a clinician could type an invalid enum value with
 * no error until the destination-table INSERT's `::allergy_severity`/
 * `::glucose_context` cast rejected it — or, worse, `is_active` rendered as
 * free text let a case-sensitive typo ("True") silently write the wrong
 * boolean with no error at all. One shared, exhaustive config removes both
 * failure classes by construction: a field not listed here defaults to
 * free-text, which is only actually true for the genuinely free-text
 * fields (allergen, reaction, drug_name, dose, frequency, provider).
 *
 * Values match the real Postgres enum definitions
 * (supabase/migrations/20260705211129_chronic_disease.sql and
 * 20260807020405_fhir_import_provenance_enums.sql) — if either enum ever
 * gains a value, this file needs the matching edit, same as any other
 * hardcoded mirror of a DB enum in this codebase.
 */
export type EditableFieldKind =
  | "readonly"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | { select: readonly string[] };

export const FIELD_KIND: Record<string, EditableFieldKind> = {
  // Identity fields — pick WHICH clinical fact this is, not a value that
  // might be slightly wrong. Never editable.
  vital_type: "readonly",
  vaccination_catalog_id: "readonly",

  // Enums — constrained to a real dropdown, never free text.
  severity: { select: ["mild", "moderate", "severe"] },
  glucose_context: { select: ["fasting", "random", "post_meal", "pre_meal", "bedtime", "night"] },

  // Booleans — a real checkbox, never a "type the word true" text field.
  is_active: "boolean",

  // Numbers.
  systolic: "number",
  diastolic: "number",
  glucose_mmol_l: "number",
  weight_kg: "number",
  temperature_c: "number",
  spo2_pct: "number",
  waist_cm: "number",
  pulse_bpm: "number",
  dose_number: "number",

  // Dates/timestamps.
  taken_at: "datetime",
  noted_at: "date",
  date_administered: "date",

  // Genuinely free text: allergen, reaction, drug_name, dose, frequency,
  // provider — anything not listed above defaults to "text".
};

export function fieldKindOf(key: string): EditableFieldKind {
  return FIELD_KIND[key] ?? "text";
}
