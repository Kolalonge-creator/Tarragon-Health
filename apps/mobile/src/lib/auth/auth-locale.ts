import * as SecureStore from "expo-secure-store";
import { resolveLocale, DEFAULT_LOCALE, t, type Locale, type MessageKey, type MessageParams } from "@tarragon/i18n";
import { getPidginEnabled } from "../pidgin-switch";

/**
 * Interface language for signed-OUT auth screens. The choice is kept on the
 * device; after sign-in it is written to profiles.language (the stored
 * interface language, text 'en' | 'pcm'). Signed-in screens keep using
 * ui-language.ts.
 */
export const AUTH_LOCALE_KEY = "auth-locale-v1";

export async function readAuthLocale(): Promise<Locale> {
  try {
    return resolveLocale(await SecureStore.getItemAsync(AUTH_LOCALE_KEY), await getPidginEnabled());
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function writeAuthLocale(locale: Locale): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUTH_LOCALE_KEY, locale);
  } catch {
    // Best effort: the choice still applies for this session via state.
  }
}

export function ta(key: MessageKey, locale: Locale, params?: MessageParams): string {
  return t(key, locale, params);
}

/** The locale only if the person actually chose one (null = never chose). */
export async function readChosenAuthLocale(): Promise<Locale | null> {
  try {
    const v = await SecureStore.getItemAsync(AUTH_LOCALE_KEY);
    return v === "en" || v === "pcm" ? v : null;
  } catch {
    return null;
  }
}

export async function clearChosenAuthLocale(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_LOCALE_KEY);
  } catch {
    // Best effort.
  }
}
