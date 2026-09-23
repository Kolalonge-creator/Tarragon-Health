import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Regression test for a dead link found by actually clicking through the
 * Health Check as a real user: every stage in the checklist except "2.
 * Mental wellbeing" had an "Open →" link, because that stage's `href` was
 * hardcoded `null` even though its check-in form (MentalHealthScreenForm)
 * exists further down the same page - a user scanning the checklist had no
 * way to reach it short of guessing to scroll. Fixed by giving that section
 * an anchor id and pointing the stage's href at it.
 *
 * This reads the source rather than importing it: `page.tsx` is a Next.js
 * App Router page module (a Server Component doing live Supabase reads),
 * which isn't practical to render in a Jest unit test, and an app router
 * page may only export a fixed set of names anyway. Comments are stripped
 * first so this file's own explanatory comments above don't trip the
 * assertions.
 */
function copyOf(...segments: string[]): string {
  const source = readFileSync(join(__dirname, ...segments), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, JSDoc included
    .replace(/^\s*\/\/.*$/gm, " "); // whole-line comments
}

const HEALTH_CHECK_PAGE = copyOf("page.tsx");

describe("health check — mental wellbeing stage link", () => {
  it("no longer points the Mental wellbeing stage at a dead href", () => {
    expect(HEALTH_CHECK_PAGE).not.toMatch(/title:\s*"2\. Mental wellbeing"[\s\S]{0,120}href:\s*null/);
  });

  it("points it at the anchor its own check-in section actually carries", () => {
    expect(HEALTH_CHECK_PAGE).toMatch(/title:\s*"2\. Mental wellbeing"[\s\S]{0,120}href:\s*"#mental-wellbeing"/);
    expect(HEALTH_CHECK_PAGE).toMatch(/id="mental-wellbeing"/);
  });
});
