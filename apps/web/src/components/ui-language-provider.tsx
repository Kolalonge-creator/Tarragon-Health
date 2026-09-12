"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_UI_LANGUAGE, t, type UiLanguage } from "@tarragon/shared";

/**
 * The patient's interface language, for the shell chrome and the everyday
 * patient surfaces (see ui-language.ts for the boundary on what is and is not
 * translatable).
 *
 * A context rather than prop-drilling, for the same reason as
 * GlucoseUnitProvider: the nav items, the phone tab bar and the group
 * headings are rendered by four different components nested several levels
 * down, and a prop one of them forgets is a row silently stuck in English
 * next to four that translated.
 *
 * Defaults to English outside a provider, so a component rendered somewhere
 * unexpected degrades to the platform default rather than to nothing.
 */
const UiLanguageContext = createContext<UiLanguage>(DEFAULT_UI_LANGUAGE);

export function UiLanguageProvider({
  language,
  children,
}: {
  language: UiLanguage;
  children: ReactNode;
}) {
  return <UiLanguageContext.Provider value={language}>{children}</UiLanguageContext.Provider>;
}

export function useUiLanguage(): UiLanguage {
  return useContext(UiLanguageContext);
}

/** `t` bound to the active language, for call sites that only need the string. */
export function useT(): (english: string) => string {
  const language = useContext(UiLanguageContext);
  return (english: string) => t(english, language);
}
