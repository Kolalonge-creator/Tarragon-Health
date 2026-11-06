/**
 * Shared design tokens (v5 spec Section 3.2, `packages/ui`).
 *
 * Source of truth for the brand palette in docs/BRAND_GUIDE.md section 5.
 * `apps/web/src/app/globals.css` mirrors these as CSS custom properties;
 * tokens.test.ts fails if the two drift apart.
 *
 * Clinical dashboard status colours are a SEPARATE system from brand colour.
 * Never use a brand token to mean green/amber/red clinical status.
 */
export const brandColors = {
  tarragonGreen: "#0E7C52",
  clinicalNavy: "#12324B",
  charcoalInk: "#171717",
  sproutGold: "#C9962B",
  softSage: "#E7EEE7",
  warmIvory: "#FAF7F0",
  deepForest: "#0B5C3E",
} as const;

export type BrandColorName = keyof typeof brandColors;

/** CSS custom property name in globals.css for each brand token. */
export const brandCssVars: Record<BrandColorName, string> = {
  tarragonGreen: "--brand-green",
  clinicalNavy: "--clinical-navy",
  charcoalInk: "--charcoal-ink",
  sproutGold: "--sprout-gold",
  softSage: "--soft-sage",
  warmIvory: "--warm-ivory",
  deepForest: "--deep-forest",
};

/**
 * Clinical status colours (patient dashboard 2.0, gap P6; spec section 19.3).
 *
 * One semantic status system, SEPARATE from brand colour: a screen asks for
 * "attention", never for "amber" and never for a brand token. Six levels:
 *
 * - critical  red     act now (a crisis-range reading, an emergency)
 * - urgent    orange  needs action soon
 * - attention amber   worth discussing, outside the usual range
 * - normal    green   within range or completed. A yellower green than
 *                     Tarragon Green on purpose, so "fine" never reads as
 *                     "brand" and a brand button never reads as "fine".
 * - info      blue    neutral information
 * - inactive  grey    paused, not tracked, no data
 *
 * Each level has three roles:
 * - `solid`: dots, icons, borders, and the fill behind white text on
 *   critical. At least 3:1 against every surface (WCAG 1.4.11).
 * - `text`: words in the status colour. At least 4.5:1 on its own tint and
 *   on every surface (WCAG 1.4.3).
 * - `tint`: the soft background behind a chip or a tile icon.
 *
 * Status is never colour alone: every use carries a word or an icon too.
 *
 * theme.css mirrors these as CSS custom properties (`--status-<level>`,
 * `--status-<level>-text`, `--status-<level>-tint`) with the dark values
 * under [data-theme="dark"]; tokens.test.ts fails if the two drift, and
 * computes every contrast ratio above. apps/mobile carries the same values
 * (apps/mobile/src/ui/design/tokens.ts, held to these by web-parity.test.ts).
 */
export const CLINICAL_STATUS_LEVELS = [
  "critical",
  "urgent",
  "attention",
  "normal",
  "info",
  "inactive",
] as const;

export type ClinicalStatusLevel = (typeof CLINICAL_STATUS_LEVELS)[number];

export interface ClinicalStatusTone {
  solid: string;
  text: string;
  tint: string;
}

export type ClinicalStatusRole = keyof ClinicalStatusTone;

export type StatusTheme = "light" | "dark";

export const clinicalStatusColors: Record<StatusTheme, Record<ClinicalStatusLevel, ClinicalStatusTone>> = {
  light: {
    critical: { solid: "#B91C1C", text: "#991B1B", tint: "#FEE2E2" },
    urgent: { solid: "#C2410C", text: "#9A3412", tint: "#FFEDD5" },
    attention: { solid: "#B45309", text: "#92400E", tint: "#FEF3C7" },
    normal: { solid: "#2E7D32", text: "#1B5E20", tint: "#E3F1E4" },
    info: { solid: "#1D4ED8", text: "#1E40AF", tint: "#DBEAFE" },
    inactive: { solid: "#78716C", text: "#57534E", tint: "#F1ECE3" },
  },
  dark: {
    critical: { solid: "#DC2626", text: "#FCA5A5", tint: "#3B1512" },
    urgent: { solid: "#EA580C", text: "#FDBA74", tint: "#3A1F0B" },
    attention: { solid: "#D97706", text: "#FCD34D", tint: "#3A2A0B" },
    normal: { solid: "#43A047", text: "#A5D6A7", tint: "#16301A" },
    info: { solid: "#3B82F6", text: "#93C5FD", tint: "#172A45" },
    inactive: { solid: "#8A847C", text: "#D6D3D1", tint: "#2C2620" },
  },
};

/** CSS custom property in theme.css for one status level and role. */
export function statusCssVar(level: ClinicalStatusLevel, role: ClinicalStatusRole): string {
  return role === "solid" ? `--status-${level}` : `--status-${level}-${role}`;
}

/** WCAG 2.x relative-luminance contrast ratio between two 6 digit hex colours. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
