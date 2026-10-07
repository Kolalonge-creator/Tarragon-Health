/**
 * Interface language for the app.
 *
 * The product is English-only (founder decisions 2026-10-06: every non-English language
 * was removed so no unreviewed clinical translation can reach a patient). The type and the `t()` helper stay only so
 * the many call sites that wrap their strings in `t(english)` keep compiling; with a single language, `t()` returns
 * its input unchanged. Do not add a language here without a native reviewer and a clinician-signed translation
 * process (see docs/CLINICAL_FEATURE_CHECKLIST.md).
 */
export type UiLanguage = "en";

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

/** The English string, unchanged. Never throws. */
export function t(english: string, _language?: UiLanguage): string {
  return english;
}
