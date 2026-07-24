/**
 * Brand tokens for the native shell — mirrors the web design system
 * (docs/BRAND_GUIDE.md): Tarragon Green primary, warm neutrals, no
 * clinical-status colours here (those belong to dashboard surfaces the
 * WebView renders, not to native chrome).
 */
export const colors = {
  brand: "#0E7C52",
  brandPressed: "#0B6342",
  navy: "#12324B",
  ink: "#1C1917",
  muted: "#57534E",
  faint: "#A8A29E",
  border: "#E7E5E4",
  background: "#FAF7F2",
  card: "#FFFFFF",
  danger: "#B3261E",
  success: "#0E7C52",
} as const;

export const radius = {
  card: 14,
  control: 10,
} as const;

export const spacing = {
  screen: 20,
  card: 16,
} as const;
