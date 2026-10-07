import { DEFAULT_LOCALE, type Locale } from "@tarragon/i18n";

/**
 * Interface language for the signed-out auth pages. The product is English-only (founder decision 2026-10-06), so
 * this is always English; it stays an async function so every page that already awaits it is unchanged.
 */
export async function getAuthLocale(): Promise<Locale> {
  return DEFAULT_LOCALE;
}
