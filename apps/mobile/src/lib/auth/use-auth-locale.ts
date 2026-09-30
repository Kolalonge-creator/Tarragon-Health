import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@tarragon/i18n";
import { DEFAULT_LOCALE } from "@tarragon/i18n";
import { readAuthLocale, writeAuthLocale } from "./auth-locale";

/** Signed-out interface language: read once, persisted on change. */
export function useAuthLocale(): [Locale, (next: Locale) => void] {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    let active = true;
    void readAuthLocale().then((l) => {
      if (active) setLocale(l);
    });
    return () => {
      active = false;
    };
  }, []);
  const choose = useCallback((next: Locale) => {
    setLocale(next);
    void writeAuthLocale(next);
  }, []);
  return [locale, choose];
}
