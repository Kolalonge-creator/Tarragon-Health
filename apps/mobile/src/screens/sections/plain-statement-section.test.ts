import { readFileSync } from "fs";
import { join } from "path";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/ui/design";

/**
 * The phone's plain statement claims large text, 44 point controls, a Listen button that only shows when a clip can play, and reduced
 * motion. Each claim is checked against the behaviour or constant that makes it true, so removing the feature turns this red.
 */
const read = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");

describe("plain statement section (phone)", () => {
  it("draws no bare React Native Text: every string goes through the kit so it follows the theme and the 2x font cap", () => {
    const src = read("screens", "sections", "plain-statement-section.tsx");
    expect(src).not.toMatch(/<Text[\s>]/);
    expect(src).not.toMatch(/import \{[^}]*\bText\b[^}]*\} from "react-native"/);
    expect(src).toMatch(/AppText/);
  });

  it("claims text up to twice its size and 44 point controls, and the constants say so", () => {
    expect(MAX_FONT_SCALE).toBe(2);
    expect(MIN_TARGET).toBeGreaterThanOrEqual(44);
    expect(read("ui", "kit", "AppText.tsx")).toMatch(/maxFontSizeMultiplier=\{MAX_FONT_SCALE\}/);
    expect(read("screens", "sections", "plain-statement-section.tsx")).toMatch(/minHeight: 44/);
  });

  it("the Listen button renders nothing unless a clip can play, and is used for emergency guidance", () => {
    const src = read("ui", "kit", "ListenButton.tsx");
    expect(src).toMatch(/canPlayClips\(/);
    expect(src).toMatch(/if \(!ready\) return null;/);
    expect(read("screens", "emergency-guidance-modal.tsx")).toMatch(/<ListenButton /);
  });

  it("reduced motion is read from the device", () => {
    const src = read("ui", "design", "provider.tsx");
    expect(src).toMatch(/setReducedMotion\(/);
    expect(src).toMatch(/isReduceMotionEnabled|reduceMotionChanged/);
  });
});
