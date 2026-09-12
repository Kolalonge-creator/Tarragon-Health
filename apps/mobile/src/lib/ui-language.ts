import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { asUiLanguage, DEFAULT_UI_LANGUAGE, t, type UiLanguage } from "@tarragon/shared";

/**
 * The signed-in patient's interface language — the native half of web's
 * UiLanguageProvider. Same dictionary, same boundary (wayfinding only; see
 * packages/shared/src/ui-language.ts).
 *
 * Cached in a module-level promise for the same reason as glucose-unit.ts:
 * the drawer, the tab bar and Overview each ask independently on one session,
 * and this changes only when the patient changes it.
 */
let cached: Promise<UiLanguage> | null = null;

async function fetchLanguage(): Promise<UiLanguage> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return DEFAULT_UI_LANGUAGE;
    const { data } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    return asUiLanguage(data?.language);
  } catch {
    // A failed preference lookup must never blank a label: fall back to the
    // platform default rather than surfacing an error state.
    return DEFAULT_UI_LANGUAGE;
  }
}

export function getUiLanguage(): Promise<UiLanguage> {
  if (!cached) cached = fetchLanguage();
  return cached;
}

/** Call after the patient changes the setting, so the next read is not stale. */
export function clearUiLanguageCache(): void {
  cached = null;
}

export function useUiLanguage(): UiLanguage {
  const [language, setLanguage] = useState<UiLanguage>(DEFAULT_UI_LANGUAGE);
  useEffect(() => {
    let active = true;
    void getUiLanguage().then((l) => {
      if (active) setLanguage(l);
    });
    return () => {
      active = false;
    };
  }, []);
  return language;
}

/** `t` bound to the active language, for call sites that only need the string. */
export function useT(): (english: string) => string {
  const language = useUiLanguage();
  return (english: string) => t(english, language);
}
