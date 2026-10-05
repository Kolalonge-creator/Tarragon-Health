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
