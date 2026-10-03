import type { SchemePreference } from "./resolve";

/**
 * Dark mode switch (decision DG-2, answered 2026-10-03: opt-in).
 *
 * Dark mode is on, but nobody gets it unless they choose it: the default
 * preference is "light", so a patient who never opens Appearance in Settings sees
 * exactly what they saw before. The four flagship tabs (Home, Vitals, Medications,
 * Messages) and the app chrome (top bar, tab bar, acting-for banner) follow the
 * scheme. The other ~65 screens, the menu drawer and the emergency guidance still
 * draw light on purpose; each moves onto the kit in Phase 2 and the Settings note
 * says so. Do not remap the legacy `colors` object to dark: legacy screens mix it
 * with their own inline colours and would show dark text on dark cards.
 */
export const DARK_MODE_ENABLED = true;

/** What a patient gets until they choose otherwise. */
export const DEFAULT_PREFERENCE: SchemePreference = "light";
