import { AUDIO_SCRIPTS, resolveLocale } from "@tarragon/i18n";
import type { Lang } from "./types";

/**
 * The language a clip plays in. It follows the app language, and so the platform-wide Pidgin switch: while that
 * is off everyone hears English, and a saved Pidgin choice is never rewritten (see `resolveLocale`).
 */
export function audioLang(locale: unknown, pidginEnabled: boolean): Lang {
  return resolveLocale(locale, pidginEnabled);
}

/** The words of a clip. Empty for an id with no script (a whole number: its text is its digits). */
export function scriptText(clipId: string, lang: Lang): string {
  return AUDIO_SCRIPTS[clipId]?.[lang] ?? "";
}
