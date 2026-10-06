/**
 * Interface language for the patient app.
 *
 * The product is English-only (founder decision 2026-10-06: the second language
 * was removed so no unreviewed clinical translation can reach a patient). The type
 * and the `t()` helper stay so the many call sites that wrap their strings in
 * `t(english, language)` keep compiling; with a single language, `t()` returns
 * its input unchanged.
 *
 * Should a second language ever return, it must arrive with a clinician-signed
 * translation process first (see docs/CLINICAL_FEATURE_CHECKLIST.md).
 */
export const UI_LANGUAGES = ["en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

/** The English string, unchanged. Kept so call sites need no change. Never throws. */
export function t(english: string, _language?: UiLanguage): string {
  return english;
}

/** Narrow a raw `profiles.language` value: there is only one language now. */
export function asUiLanguage(_value?: string | null): UiLanguage {
  return DEFAULT_UI_LANGUAGE;
}
