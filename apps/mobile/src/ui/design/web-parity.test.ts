/**
 * Web and mobile share one brand. packages/ui/src/tokens.ts is the source of
 * truth (docs/BRAND_GUIDE.md section 5); the mobile palettes must carry the
 * same value for every role that exists on both. Without this, a brand colour
 * change on one surface was invisible to the other (design audit, P1 item 7).
 *
 * Read by path rather than import: the mobile app does not depend on
 * @tarragon/ui, and this file is test-only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lightPalette } from "./tokens";

const webSource = readFileSync(join(__dirname, "../../../../../packages/ui/src/tokens.ts"), "utf8");

function webColor(name: string): string {
  const match = new RegExp(`${name}:\\s*"(#[0-9A-Fa-f]{6})"`).exec(webSource);
  if (!match) throw new Error(`web token ${name} not found in packages/ui/src/tokens.ts`);
  return match[1].toUpperCase();
}

describe("mobile tokens match the web brand tokens", () => {
  const pairs: [string, keyof typeof lightPalette][] = [
    ["tarragonGreen", "brand"],
    ["clinicalNavy", "navy"],
    ["softSage", "brandTint"],
    ["warmIvory", "canvas"],
  ];
  it.each(pairs)("web %s equals mobile light %s", (webName, mobileRole) => {
    expect(String(lightPalette[mobileRole]).toUpperCase()).toBe(webColor(webName));
  });
});
