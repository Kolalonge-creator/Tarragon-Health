import { en, type MessageKey } from "./en";
import { pcm } from "./pcm";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./translate";

export { LOCALES, DEFAULT_LOCALE, catalogues, t, type Locale, type MessageParams } from "./translate";

export type { MessageKey };
export { en, pcm };

export function asLocale(value: unknown): Locale {
  return (LOCALES as readonly unknown[]).includes(value) ? (value as Locale) : DEFAULT_LOCALE;
}

/** `asLocale`, but honouring the platform-wide Pidgin kill switch: off means English for everyone. */
export function resolveLocale(value: unknown, pidginEnabled: boolean): Locale {
  return pidginEnabled ? asLocale(value) : DEFAULT_LOCALE;
}

/** The locales to offer: Pidgin is hidden while the kill switch is off. */
export function availableLocales(pidginEnabled: boolean): readonly Locale[] {
  return pidginEnabled ? LOCALES : ([DEFAULT_LOCALE] as const);
}

export * from "./care-change";
export * from "./monthly-report";
export * from "./audio-scripts";
