import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The plain statement makes factual claims about the code. This pins each one to the file that makes it true, so a claim cannot
 * outlive its feature. If one of these fails, change the statement (packages/i18n `plain.*`), not the test.
 */
const REPO = join(process.cwd(), "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("plain statement claims match the code", () => {
  it("text can grow to twice its size and kit controls are 44 points", () => {
    expect(read("apps/mobile/src/ui/design/typography.ts")).toMatch(/MAX_FONT_SCALE = 2/);
    expect(existsSync(join(REPO, "apps/mobile/src/ui/design/text-scaling.test.ts"))).toBe(true);
  });
  it("an automated scan checks roles and names on tappable controls", () => {
    expect(existsSync(join(REPO, "apps/mobile/src/ui/a11y-scan.test.ts"))).toBe(true);
  });
  it("the Listen button only shows when a clip can play, and the words stay", () => {
    expect(read("apps/mobile/src/ui/kit/ListenButton.tsx")).toMatch(/canPlayClips/);
    expect(read("apps/mobile/src/screens/emergency-guidance-modal.tsx")).toMatch(/ListenButton/);
  });
  it("motion is reduced on web and phone, and the site has a skip link", () => {
    expect(read("apps/web/src/app/globals.css")).toMatch(/prefers-reduced-motion: reduce/);
    expect(read("apps/mobile/src/ui/design/provider.tsx")).toMatch(/reducedMotion/);
    expect(read("apps/web/src/app/(marketing)/layout.tsx")).toMatch(/Skip to content/);
  });
  it("no advertising SDK is a dependency of the web or phone app", () => {
    const banned = /(admob|google-mobile-ads|expo-ads|applovin|appsflyer|react-native-fbsdk|facebook-android-sdk|adjust|ironsource|unity-ads|advertising-id)/i;
    for (const pkg of ["apps/web/package.json", "apps/mobile/package.json"]) {
      const json = JSON.parse(read(pkg)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const names = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
      expect(names.filter((n) => banned.test(n))).toEqual([]);
    }
  });
  it("the phone app does not declare the advertising ID permission", () => {
    expect(read("apps/mobile/app.json")).not.toMatch(/AD_ID/);
  });
});
