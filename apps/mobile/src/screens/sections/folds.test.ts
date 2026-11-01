import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Safety check for the folded sections. This package tests pure logic only (no component rendering), so like
 * cycle-screen.label.test.ts this reads the source: urgent-help and privacy controls must never sit inside a Disclosure.
 */
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

/** Every <Disclosure ...> ... </Disclosure> body in the source. */
function foldedBodies(src: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = src.indexOf("<Disclosure ", at);
    if (open === -1) return out;
    const close = src.indexOf("</Disclosure>", open);
    out.push(src.slice(open, close));
    at = close + 1;
  }
}

describe("folded sections never hide urgent help", () => {
  it("women's health keeps danger signs and the pregnancy check outside every fold", () => {
    const src = read("womens-health-screen.tsx");
    expect(foldedBodies(src).length).toBeGreaterThan(0);
    for (const body of foldedBodies(src)) {
      expect(body).not.toMatch(/CycleDangerSigns|PregnancyRedFlagCheck|PregnancyDangerGuideCard|EmergencyGuidanceModal|bleeding_urgent|warning signs/);
    }
    expect(src).toMatch(/outside=\{[\s\S]*<CycleDangerSigns \/>/);
  });

  it("the contraception condition caution stays visible", () => {
    const src = read("womens-health-screen.tsx");
    for (const body of foldedBodies(src)) expect(body).not.toMatch(/CautionNote/);
  });

  it("cycle keeps flags, danger signs and the fertile window label outside every fold", () => {
    const src = read("cycle-screen.tsx");
    expect(foldedBodies(src).length).toBe(2);
    for (const body of foldedBodies(src)) {
      expect(body).not.toMatch(/FlagsCard|CycleDangerSigns|FertileWindowNotice|urgent/);
    }
  });

  it("sexual health keeps emergency contraception, the PIN row and the privacy note outside every fold", () => {
    const src = read("sexual-health-screen.tsx");
    expect(foldedBodies(src).length).toBe(3);
    for (const body of foldedBodies(src)) {
      expect(body).not.toMatch(/EmergencyContraceptionCard|PrivacySettingsRow|ConfidentialMessageCard|Need emergency contraception|Privacy PIN/);
    }
    const hub = src.slice(src.indexOf("function SexualHealthHub"));
    expect(hub.indexOf("<PrivacySettingsRow")).toBeLessThan(hub.indexOf("{TABS.map"));
  });

  it("sexual health testing tab folds only the booking panel", () => {
    const bodies = foldedBodies(read("sexual-health-testing-tab.tsx"));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/STI testing/);
  });
});
