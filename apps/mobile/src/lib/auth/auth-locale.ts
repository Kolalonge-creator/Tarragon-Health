import { t, type Locale, type MessageKey, type MessageParams } from "@tarragon/i18n";

/**
 * Strings for the signed-OUT auth screens. The product is English-only (founder decision 2026-10-06), so there is
 * no language to choose or remember; screens pass DEFAULT_LOCALE.
 */
export function ta(key: MessageKey, locale: Locale, params?: MessageParams): string {
  return t(key, locale, params);
}
