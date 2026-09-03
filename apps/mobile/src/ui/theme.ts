/**
 * Brand tokens for the native shell — mirrors the web design system
 * (docs/BRAND_GUIDE.md): Tarragon Green primary, warm neutrals. Clinical
 * status colours originally lived only on dashboard surfaces the WebView
 * renders, but native chrome has since grown its own status surfaces (the
 * urgent vitals banner, the emergency card and guidance modal), so the
 * managed set now lives here too — see `colors.status`.
 */
export const colors = {
  brand: "#0E7C52",
  brandPressed: "#0B6342",
  /** Soft brand-green fill behind avatar initials, active nav tiles, and
   * brand-toned badges. */
  brandTint: "#E7EEE7",
  /** Slightly cooler brand-green fill used behind device/health-sync icons
   * (Devices list, Apple Health / Health Connect cards). */
  brandTintAlt: "#E8F3EE",
  navy: "#12324B",
  ink: "#1C1917",
  muted: "#57534E",
  faint: "#A8A29E",
  border: "#E7E5E4",
  background: "#FAF7F2",
  card: "#FFFFFF",
  /** Pressed-state fill for white/bordered controls (SecondaryButton, the
   * acting-for banner's button) — one step down from `card`. */
  pressed: "#F5F5F4",
  /** Flat fill for grouped-list rows and quick-action tiles — a step back
   * from `card` so a row reads as recessed content rather than another
   * elevated card sitting on the screen background. */
  groupBg: "#F1ECE3",
  danger: "#B3261E",
  success: "#0E7C52",
  /** Clinical-status colours rendered by native chrome (not the WebView). */
  status: {
    /** Amber text for a non-emergency "needs attention" message. */
    warn: "#B45309",
    /** Amber background behind `warn` text (urgent banner, offline notice). */
    warnBg: "#FEF3C7",
    /** Critical/red surfaces and text — same value as `danger`, named here
     * so status surfaces don't each pick their own near-identical red. */
    critical: "#B3261E",
    /** The emergency guidance modal's alarm red — deliberately brighter than
     * `critical`: it mirrors the web EmergencyAlert (apps/web/src/app/
     * (dashboard)/patient/emergency-alert.tsx, Tailwind red-600) so the two
     * emergency surfaces read as the same feature. Don't "unify" it into
     * `danger` without also changing the web side. */
    emergency: "#DC2626",
  },
} as const;

/** Ink (`colors.ink`, #1C1917) at the given opacity — use this for every
 * translucent grey (scrims, subdued icons, inactive fills) so greys derive
 * from the ink tone instead of ad-hoc `rgba(23,23,23,…)` literals. */
export function inkAlpha(opacity: number): string {
  return `rgba(28,25,23,${opacity})`;
}

export const radius = {
  card: 14,
  control: 10,
} as const;

export const spacing = {
  screen: 20,
  card: 16,
} as const;
