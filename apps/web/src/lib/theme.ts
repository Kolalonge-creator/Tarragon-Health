/**
 * Theme preference shared between the server (dashboard layout reads the
 * cookie for a flash-free first paint) and the client (ThemeToggle writes
 * it). Lives outside any "use client" module on purpose: importing a value
 * through a client boundary hands the server a client-reference proxy, not
 * the string, which silently broke the cookie read once already.
 */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_COOKIE = "th-theme";

export function parseThemePreference(value: string | undefined): ThemePreference {
  return value === "dark" || value === "system" ? value : "light";
}
