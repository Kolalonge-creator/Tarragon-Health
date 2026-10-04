import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Sora_600SemiBold, Sora_700Bold } from "@expo-google-fonts/sora";
import { fontFamily } from "./typography";

/**
 * The six font files the kit uses (Sora for headlines, Inter for the interface),
 * keyed by the family names in typography.ts. Passed to useFonts at app start;
 * the splash holds until they load so text never flashes in a different face.
 * Fonts are SIL OFL 1.1 (free for commercial use), bundled by the
 * @expo-google-fonts packages.
 */
export const FONT_ASSETS = {
  [fontFamily.headingBold]: Sora_700Bold,
  [fontFamily.headingSemi]: Sora_600SemiBold,
  [fontFamily.body]: Inter_400Regular,
  [fontFamily.bodyMedium]: Inter_500Medium,
  [fontFamily.bodySemi]: Inter_600SemiBold,
  [fontFamily.bodyBold]: Inter_700Bold,
};
