export type ConditionLanguagePreference = "gentle" | "clinical";

/**
 * Small, explicit dictionary rather than a find/replace — only the handful
 * of patient-facing surfaces that actually name this condition read from it.
 * "gentle" matches the platform-wide default set in the 2026-07-30
 * marketing-site-redesign pass; "clinical" is opt-in per patient via
 * profiles.condition_language_preference, never the platform's own default.
 */
const OBESITY_LABEL: Record<ConditionLanguagePreference, string> = {
  gentle: "weight",
  clinical: "obesity",
};

const OBESITY_TITLE_CASE: Record<ConditionLanguagePreference, string> = {
  gentle: "Weight",
  clinical: "Obesity",
};

/**
 * Accepts plain `string | null | undefined` rather than the narrower
 * ConditionLanguagePreference type — the DB column is an unconstrained
 * `text` at the generated-types level (Supabase codegen doesn't reflect
 * CHECK constraints), so every caller reading profiles.condition_language_preference
 * has a bare string. Anything other than exactly "clinical" is treated as
 * the gentle default, matching the column's own DB-level default.
 */
export function obesityLabel(preference: string | null | undefined): string {
  return OBESITY_LABEL[preference === "clinical" ? "clinical" : "gentle"];
}

export function obesityLabelTitleCase(preference: string | null | undefined): string {
  return OBESITY_TITLE_CASE[preference === "clinical" ? "clinical" : "gentle"];
}
