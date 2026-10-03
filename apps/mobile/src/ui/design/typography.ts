/**
 * Type scale for the new kit. Brand guide section 6: Sora for headlines, Inter
 * for product UI and body. Font family names are the keys @expo-google-fonts
 * registers with useFonts (see FONT_ASSETS in fonts.ts); a screen never names a
 * family or a raw font size, it picks a variant.
 *
 * Sizes keep the existing `typeScale` anchors (hero 40, stat 26, title 20, body
 * 14, caption 12) and add the steps the redesign needs, so moving a screen onto
 * the kit is a refinement, not a jump.
 */
export const fontFamily = {
  headingBold: "Sora_700Bold",
  headingSemi: "Sora_600SemiBold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
} as const;

export type TextVariant =
  | "hero"
  | "stat"
  | "headline"
  | "title"
  | "bodyLarge"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption";

export interface TextStyleSpec {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export const textStyles: Record<TextVariant, TextStyleSpec> = {
  hero: { fontFamily: fontFamily.headingBold, fontSize: 40, lineHeight: 46, letterSpacing: -0.8 },
  stat: { fontFamily: fontFamily.headingBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  headline: { fontFamily: fontFamily.headingBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  title: { fontFamily: fontFamily.headingSemi, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  bodyLarge: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  body: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 21, letterSpacing: 0 },
  bodyStrong: { fontFamily: fontFamily.bodySemi, fontSize: 14, lineHeight: 21, letterSpacing: 0 },
  label: { fontFamily: fontFamily.bodySemi, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
  caption: { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 17, letterSpacing: 0.1 },
};

/**
 * Cap on how far system text size can scale. 2.0 is the WCAG 1.4.4 floor (text must
 * resize to 200 percent without loss), so this must never go below it. Past 2.0 the
 * system's largest accessibility sizes stop growing, but every container grows with
 * its text (no fixed heights on text), so nothing is clipped.
 */
export const MAX_FONT_SCALE = 2;
