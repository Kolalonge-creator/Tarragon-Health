/**
 * Google Play rejected the Android app (2026-09-17, Impersonation policy) because the Guard Leaf's shield plus checkmark read
 * as a "verified" badge. The vein is a pulse line now, and the website is the developer account's verified site, so neither
 * inline SVG copy of the mark may draw the checkmark again (docs/BRAND_GUIDE.md §4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MARKS = [
  join(__dirname, "../../../../../packages/ui/src/components/guard-leaf-mark.tsx"),
  join(__dirname, "../../app/(marketing)/_components/brand-logo.tsx"),
];
const OLD_CHECKMARK = "M36 65L46 75L67 50";
const PULSE_LINE = "M31 62H40L45 55L50 71L55 45L59 62H71";

describe("Guard Leaf mark", () => {
  it.each(MARKS)("draws the pulse line, not the checkmark: %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain(OLD_CHECKMARK);
    expect(source).toContain(PULSE_LINE);
  });
});
