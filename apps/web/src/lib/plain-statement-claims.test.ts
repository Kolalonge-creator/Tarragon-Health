import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The plain statement makes factual claims about the code. This pins each one to the code that makes it true, so a claim cannot
 * outlive its feature. If one of these fails, change the statement (packages/i18n `plain.*`), not the test. The phone-side
 * behaviour checks live in apps/mobile/src/screens/sections/plain-statement-section.test.ts.
 */
const REPO = join(process.cwd(), "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

/** Exact package names only: a bare substring such as "adjust" would match unrelated packages. */
const BANNED_AD_PACKAGES = new Set([
  "react-native-google-mobile-ads",
  "@react-native-google-mobile-ads/app",
  "expo-ads-admob",
  "expo-ads-facebook",
  "react-native-fbsdk-next",
  "react-native-fbsdk",
  "react-native-appsflyer",
  "react-native-adjust",
  "react-native-applovin-max",
  "react-native-ironsource-mediation",
  "react-native-unity-ads",
  "react-native-advertising-id",
  "react-native-branch",
  "react-native-kochava",
  "react-native-singular",
]);

describe("plain statement claims match the code", () => {
  it("text can grow to twice its size and kit controls are at least 44 points", () => {
    expect(read("apps/mobile/src/ui/design/typography.ts")).toMatch(/MAX_FONT_SCALE = 2;/);
    expect(read("apps/mobile/src/ui/design/tokens.ts")).toMatch(/MIN_TARGET\s*=\s*(4[4-9]|[5-9]\d)\b/);
  });

  it("the Listen button shows only when a clip can play, and is used for emergency guidance", () => {
    expect(read("apps/mobile/src/ui/kit/ListenButton.tsx")).toMatch(/if \(!ready\) return null;/);
    expect(read("apps/mobile/src/screens/emergency-guidance-modal.tsx")).toMatch(/<ListenButton /);
  });

  it("motion is reduced on web and phone, and the website and web app have a skip link", () => {
    expect(read("apps/web/src/app/globals.css")).toMatch(/prefers-reduced-motion: reduce/);
    expect(read("apps/mobile/src/ui/design/provider.tsx")).toMatch(/setReducedMotion\(/);
    expect(read("apps/web/src/app/(marketing)/layout.tsx")).toMatch(/Skip to content/);
    expect(read("apps/web/src/components/shell/app-shell.tsx")).toMatch(/Skip to content/);
  });

  it("no advertising package (exact names) is a dependency of the web or phone app", () => {
    for (const pkg of ["apps/web/package.json", "apps/mobile/package.json"]) {
      const json = JSON.parse(read(pkg)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const names = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
      expect(names.filter((n) => BANNED_AD_PACKAGES.has(n))).toEqual([]);
    }
  });

  it("the phone app does not ask for the advertising ID permission (app.json and app.config.js)", () => {
    expect(read("apps/mobile/app.json")).not.toMatch(/AD_ID/);
    expect(read("apps/mobile/app.config.js")).not.toMatch(/AD_ID/);
  });

  it("the ban list is exact: it catches a real ad package and ignores an unrelated name", () => {
    expect(BANNED_AD_PACKAGES.has("react-native-google-mobile-ads")).toBe(true);
    expect(BANNED_AD_PACKAGES.has("adjust-parser")).toBe(false);
  });
});
