import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "../src/lib/marketing/routes";

const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// Every built marketing page, plus the legal pages and one health-library article (the article template: provenance,
// references). The article is in the built-in library, so it exists with or without the database.
const EXTRA_PATHS = ["/privacy", "/terms", "/cookies", "/accessibility", "/telehealth-consent", "/resources/normal-blood-pressure"];
const PATHS = [...new Set([...MARKETING_ROUTES_BUILT.map((key) => MARKETING_ROUTES[key]), ...EXTRA_PATHS])]
  .map((href) => href.split("#")[0]!)
  .filter((href) => href.startsWith("/"));

type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] };

async function axeViolations(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((v: AxeViolation) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
    }));
  });
}

function describe(violations: AxeViolation[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")}: ${(n.failureSummary ?? "").split("\n").slice(1).join(" ")}`).join("\n")}`)
    .join("\n");
}

for (const path of PATHS) {
  test(`WCAG 2.2 AA: ${path}`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status(), `${path} should load`).toBeLessThan(400);
    // Let the reveal-on-load fades finish so contrast is measured on the final colours.
    await page.waitForTimeout(1200);
    const violations = await axeViolations(page);
    expect(violations, describe(violations)).toEqual([]);
  });
}

// Pages whose hero plays a muted ambient video. The control block proves each one really has a visible video for an
// ordinary visitor, so the reduced-motion block cannot pass just because a page lost its video.
const VIDEO_PATHS = ["/hypertension", "/diabetes", "/prevention", "/chronic-care"];

async function visibleVideoCount(page: Page): Promise<number> {
  return page.locator("video").evaluateAll(
    (videos) => videos.filter((v) => (v as HTMLElement).offsetParent !== null && getComputedStyle(v).display !== "none").length
  );
}

test.describe("motion: control", () => {
  test.use({ reducedMotion: "no-preference" });
  for (const path of VIDEO_PATHS) {
    test(`video shows by default: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(
        await visibleVideoCount(page),
        `${path} no longer has a hero video. If that was a content change, take it out of VIDEO_PATHS; this is not an accessibility failure.`
      ).toBeGreaterThan(0);
    });
  }
});

test.describe("motion: reduced", () => {
  test.use({ reducedMotion: "reduce" });
  for (const path of VIDEO_PATHS) {
    test(`no moving video when reduced motion is asked for: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(await visibleVideoCount(page)).toBe(0);
    });
  }
});
