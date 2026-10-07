import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FERTILE_WINDOW_LABEL, FERTILE_WINDOW_LINK_TEXT } from "@tarragon/i18n";

/**
 * S85 D2 / OQ-12 on the phone. This package tests pure logic only (no component rendering, see jest.config.mjs), so the
 * cycle screen's label is checked from its source: every place the screen shows the fertile window or a temperature
 * ovulation confirmation is behind `planningMode`, and each is followed by the shared label, which is the founder's
 * exact wording. It has NOT been run on a device or simulator.
 */

const SOURCE = readFileSync(join(__dirname, "cycle-screen.tsx"), "utf8");

/** Problems found in a copy of the screen source. Empty means every window surface is gated and labelled. */
export function labelProblems(source: string): string[] {
  const problems: string[] = [];
  if (!/FERTILE_WINDOW_LABEL/.test(source) || !/FERTILE_WINDOW_LINK_TEXT/.test(source)) {
    problems.push("the screen does not use the shared label and link text");
  }
  if (/Not contraception|cannot prevent pregnancy/i.test(source)) {
    problems.push("the label is typed into the screen instead of coming from the wording source");
  }
  // Each place the window is shown must sit inside a planningMode block.
  for (const shown of ["Estimated ovulation", "Fertile window {shortDate", "THERMAL_SHIFT_EXPLAINER}"]) {
    const at = source.indexOf(shown);
    if (at === -1) {
      problems.push(`expected surface missing: ${shown}`);
      continue;
    }
    const before = source.slice(Math.max(0, at - 900), at);
    if (!/planningMode\s*(&&|\?)/.test(before)) problems.push(`not gated by planningMode: ${shown}`);
  }
  // The label is rendered in the what-to-expect card, the where-you-are-now card and the day log.
  const rendered = (source.match(/<FertileWindowNotice onNavigate/g) ?? []).length;
  if (rendered < 3) problems.push(`label rendered ${rendered} times, expected at least 3`);
  // It is never behind a hide prop.
  if (/FertileWindowNotice[^>]*\bhidden\b/.test(source)) problems.push("the label has a hide prop");
  return problems;
}

describe("the phone cycle screen carries the fertile window label (S85 D2)", () => {
  it("every window surface is behind Planning a pregnancy and labelled", () => {
    expect(labelProblems(SOURCE)).toEqual([]);
  });

  it("the label comes from the one wording source, with the founder's exact words", () => {
    expect(FERTILE_WINDOW_LABEL).toBe("Not contraception. This cannot prevent pregnancy.");
    expect(FERTILE_WINDOW_LINK_TEXT).toBe("Learn about contraception and talk to your care team.");
  });

  it("the switch is off until loaded", () => {
    expect(SOURCE).toMatch(/useState\(false\);\s*\n\s*const \[modePending/);
  });

  it("sabotage: removing the label makes the check fail", () => {
    expect(labelProblems(SOURCE.replaceAll("<FertileWindowNotice onNavigate", "<NothingHere onNavigate")).length).toBeGreaterThan(0);
  });

  it("sabotage: ungating the ovulation tile makes the check fail", () => {
    expect(labelProblems(SOURCE.replace("{planningMode && (\n              <View style={{ flexBasis", "{true && (\n              <View style={{ flexBasis")).length).toBeGreaterThan(0);
  });

  it("sabotage: typing the words into the screen makes the check fail", () => {
    expect(labelProblems(`${SOURCE}\n// <Text>Not contraception.</Text>`).length).toBeGreaterThan(0);
  });
});
