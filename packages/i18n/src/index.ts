import { en, type MessageKey } from "./en";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./translate";

// One language (decision D-14). The lookup lives in translate.ts so the monthly-report helpers can import it without a cycle through this file.
export { LOCALES, DEFAULT_LOCALE, catalogues, t, type Locale, type MessageParams } from "./translate";
export type { MessageKey };
export { en };
export { activeWording, speakable, WORDING_CODES, WORDING_KEYS, WORDING_SIGNED, type WordingCode } from "./clinical-wording";
export {
  activeFertileWindowWording,
  FERTILE_WINDOW_BANNED_PHRASES,
  FERTILE_WINDOW_LABEL,
  FERTILE_WINDOW_LINK_TEXT,
  FERTILE_WINDOW_SIGNED,
  type FertileWindowWords,
} from "./clinical-wording";

export function asLocale(value: unknown): Locale {
  return (LOCALES as readonly unknown[]).includes(value) ? (value as Locale) : DEFAULT_LOCALE;
}

export * from "./care-change";
export * from "./audio-scripts";
export * from "./monthly-report";
