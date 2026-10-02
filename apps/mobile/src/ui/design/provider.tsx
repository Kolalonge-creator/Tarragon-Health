import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Appearance, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DARK_MODE_ENABLED } from "./config";
import { isSchemePreference, resolveScheme, type SchemePreference } from "./resolve";
import { palettes, type Palette, type Scheme } from "./tokens";

const PREFERENCE_KEY = "@tarragon/theme-preference/v1";

interface ThemeValue {
  scheme: Scheme;
  colors: Palette;
  preference: SchemePreference;
  setPreference: (next: SchemePreference) => void;
  /** True when the patient asked the OS for less motion. Kit components skip animation. */
  reducedMotion: boolean;
}

const ThemeContext = createContext<ThemeValue>({
  scheme: "light",
  colors: palettes.light,
  preference: "system",
  setPreference: () => {},
  reducedMotion: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<SchemePreference>("system");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PREFERENCE_KEY)
      .then((value) => {
        if (isSchemePreference(value)) setPreferenceState(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReducedMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const scheme = resolveScheme(preference, system, DARK_MODE_ENABLED);

  // With dark mode off, pin the whole OS-level appearance to light so native
  // chrome matches; with it on, follow the preference (null means follow the system).
  useEffect(() => {
    Appearance.setColorScheme(DARK_MODE_ENABLED ? (preference === "system" ? null : preference) : "light");
  }, [preference]);

  const setPreference = useCallback((next: SchemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(PREFERENCE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ scheme, colors: palettes[scheme], preference, setPreference, reducedMotion }),
    [scheme, preference, setPreference, reducedMotion]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
