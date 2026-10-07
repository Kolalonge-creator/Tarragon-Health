import { en, type MessageKey } from "./en";

export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type { MessageKey };
export { en };
export { activeWording, speakable, WORDING_CODES, WORDING_KEYS, WORDING_SIGNED, type WordingCode } from "./clinical-wording";

export const catalogues: Record<Locale, Record<MessageKey, string>> = { en };

export type MessageParams = Record<string, string | number>;

/** Replace `{name}` placeholders. A missing param is left visible so it is noticed in review, never silently blank. */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Look up a string. Falls back to English for an unknown locale so the UI
 * never renders a raw key for a supported key.
 */
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE, params?: MessageParams): string {
  const table = catalogues[locale] ?? catalogues[DEFAULT_LOCALE];
  return interpolate(table[key] ?? catalogues[DEFAULT_LOCALE][key], params);
}

export function asLocale(value: unknown): Locale {
  return (LOCALES as readonly unknown[]).includes(value) ? (value as Locale) : DEFAULT_LOCALE;
}

export * from "./care-change";
export * from "./audio-scripts";
