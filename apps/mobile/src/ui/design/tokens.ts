/**
 * Design tokens for the new UI kit (design Phase 0, decisions DG-1 to DG-6).
 * Two complete palettes, light and dark, chosen so every text role passes
 * WCAG AA (4.5 to 1, 3 to 1 for large text) on every surface it can sit on;
 * tokens.test.ts computes this, so a colour edit that breaks contrast fails CI.
 *
 * Roles, not colours: a screen asks for `text`, `surface`, `brandText`, never a
 * hex. Raw hex outside this file is a lint error inside src/ui/kit and a warning
 * elsewhere. The legacy `colors` object in ../theme.ts stays for screens that
 * have not moved onto the kit yet (design plan, Phase 2).
 *
 * Canvas follows docs/BRAND_GUIDE.md section 5: the patient surface sits on Warm
 * Ivory with white cards. Clinical status colours stay a separate system from
 * brand colour and red is reserved for true alerts.
 */
export interface Palette {
  /** Screen background. */
  canvas: string;
  /** Cards, sheets, inputs. */
  surface: string;
  /** Recessed fills: grouped rows, chips, skeleton base. */
  surfaceMuted: string;
  /** Hairlines and card outlines. */
  border: string;
  /** Primary text. */
  text: string;
  /** Secondary text. */
  textMuted: string;
  /** Tertiary text, captions, placeholders. Still AA. */
  textSubtle: string;
  /** Fill for primary buttons and brand marks. */
  brand: string;
  brandPressed: string;
  /** Text on a `brand` fill. */
  textOnBrand: string;
  /** Brand-coloured TEXT and links, safe on every surface. */
  brandText: string;
  /** Soft brand fill behind icons and active tiles. */
  brandTint: string;
  navy: string;
  /** Amber text and its soft background (needs attention, offline notice). */
  warnText: string;
  warnBg: string;
  /** Red text and its soft background (urgent, could not be saved). */
  dangerText: string;
  dangerBg: string;
  /** Emergency guidance only: same red as the web EmergencyAlert. */
  emergency: string;
  textOnEmergency: string;
  /** Backdrop behind sheets and modals. */
  scrim: string;
  /** Keyboard focus ring and selection. */
  focus: string;
}

export const lightPalette: Palette = {
  canvas: "#FAF7F2",
  surface: "#FFFFFF",
  surfaceMuted: "#F1ECE3",
  border: "#E7E5E4",
  text: "#1C1917",
  textMuted: "#57534E",
  textSubtle: "#6B6560",
  brand: "#0E7C52",
  brandPressed: "#0B6342",
  textOnBrand: "#FFFFFF",
  brandText: "#0B6342",
  brandTint: "#E7EEE7",
  navy: "#12324B",
  warnText: "#92400E",
  warnBg: "#FEF3C7",
  dangerText: "#B3261E",
  dangerBg: "#FDECEA",
  emergency: "#DC2626",
  textOnEmergency: "#FFFFFF",
  scrim: "rgba(28,25,23,0.45)",
  focus: "#0E7C52",
};

export const darkPalette: Palette = {
  canvas: "#0F1412",
  surface: "#171E1B",
  surfaceMuted: "#1F2825",
  border: "#2A3531",
  text: "#F2F1EE",
  textMuted: "#B8B5AF",
  textSubtle: "#9C9993",
  brand: "#0E7C52",
  brandPressed: "#0B6342",
  textOnBrand: "#FFFFFF",
  brandText: "#4FC08D",
  brandTint: "#16352A",
  navy: "#9CC3E0",
  warnText: "#F5B454",
  warnBg: "#3A2A0B",
  dangerText: "#F2766E",
  dangerBg: "#3B1512",
  emergency: "#DC2626",
  textOnEmergency: "#FFFFFF",
  scrim: "rgba(0,0,0,0.6)",
  focus: "#4FC08D",
};

export type Scheme = "light" | "dark";

export const palettes: Record<Scheme, Palette> = { light: lightPalette, dark: darkPalette };

/** 4 point spacing scale. Index by name, never by number. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Minimum touch target in points (spec D.2, WCAG 2.5.8 target size). */
export const MIN_TARGET = 44;

/**
 * Elevation. Light surfaces lift with a soft shadow; dark surfaces cannot show a
 * shadow on a near-black canvas, so they use the border instead.
 */
export function elevation(scheme: Scheme, level: 0 | 1 | 2): {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
} {
  if (scheme === "dark" || level === 0) {
    return { shadowColor: "#000000", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 };
  }
  return level === 1
    ? { shadowColor: "#1C1917", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }
    : { shadowColor: "#1C1917", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 4 };
}

/** WCAG relative luminance and contrast ratio, used by tokens.test.ts. */
export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [hi, lo] = [lum(foreground), lum(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
