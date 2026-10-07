import { DEFAULT_UI_LANGUAGE, t, type UiLanguage } from "@tarragon/shared";

/**
 * The interface language of the app. English only (founder decision 2026-10-06), so these helpers return a
 * constant; they stay so the many screens that already call useUiLanguage() / useT() are unchanged.
 */
export function getUiLanguage(): Promise<UiLanguage> {
  return Promise.resolve(DEFAULT_UI_LANGUAGE);
}

export function useUiLanguage(): UiLanguage {
  return DEFAULT_UI_LANGUAGE;
}

/** `t` bound to the active language, for call sites that only need the string. */
export function useT(): (english: string) => string {
  return (english: string) => t(english, DEFAULT_UI_LANGUAGE);
}
