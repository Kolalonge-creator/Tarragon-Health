import type { Scheme } from "./tokens";

export type SchemePreference = "system" | "light" | "dark";

/**
 * Which scheme to render. Pure so it is unit tested: the preference wins, the
 * system scheme decides for "system", and with dark mode switched off (config.ts)
 * everything resolves to light.
 */
export function resolveScheme(
  preference: SchemePreference,
  systemScheme: "light" | "dark" | null | undefined,
  darkEnabled: boolean
): Scheme {
  if (!darkEnabled) return "light";
  if (preference === "light" || preference === "dark") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}

export function isSchemePreference(value: unknown): value is SchemePreference {
  return value === "system" || value === "light" || value === "dark";
}
