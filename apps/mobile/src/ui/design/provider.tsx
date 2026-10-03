import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Appearance } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DARK_MODE_ENABLED, DEFAULT_PREFERENCE } from "./config";
import { isSchemePreference, resolveScheme, type SchemePreference } from "./resolve";
import { palettes, type Palette, type Scheme } from "./tokens";

const PREFERENCE_KEY = "@tarragon/theme-preference/v1";

// The OS-level appearance stays pinned to light on purpose, even with dark mode on.
// The in-app scheme (the palette) is what goes dark. Pinning keeps every native default
// that legacy screens rely on (default text colour, switches, pickers, the first frames
// of a launch) light, so an old screen can never render white text on a white card.
// Kit inputs ask for a dark keyboard themselves (keyboardAppearance). The cost: native
// alerts and the share sheet stay light in dark mode, which is acceptable. This also
// means the OS dark setting cannot be read, so the choice is Light or Dark, never System.
Appearance.setColorScheme("light");

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
  preference: DEFAULT_PREFERENCE,
  setPreference: () => {},
  reducedMotion: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<SchemePreference>(DEFAULT_PREFERENCE);
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

  const scheme = resolveScheme(preference, null, DARK_MODE_ENABLED);

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

/**
 * Draws its children in the light scheme whatever the patient chose. For a surface that
 * holds a screen which has not moved onto the kit yet (it is light-only), so the kit
 * parts around it (a header, a Close button) match it instead of fighting it.
 */
export function ForceLight({ children }: { children: ReactNode }) {
  const base = useContext(ThemeContext);
  const value = useMemo<ThemeValue>(() => ({ ...base, scheme: "light", colors: palettes.light }), [base]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
