/**
 * Clinical status colours on mobile (patient dashboard 2.0, P6). Contrast is
 * computed against the mobile palettes' own surfaces, and the values are held
 * to the web source of truth (packages/ui/src/tokens.ts) by path, the same way
 * web-parity.test.ts reads the brand tokens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clinicalStatus, contrastRatio, palettes, type ClinicalStatusLevel, type Scheme } from "./tokens";

const LEVELS: ClinicalStatusLevel[] = ["critical", "urgent", "attention", "normal", "info", "inactive"];
const SCHEMES: Scheme[] = ["light", "dark"];

describe.each(SCHEMES)("%s clinical status contrast", (scheme) => {
  const palette = palettes[scheme];
  const surfaces = [palette.canvas, palette.surface, palette.surfaceMuted];

  it.each(LEVELS)("%s text is at least 4.5:1 on its tint and on every surface", (level) => {
    const { text, tint } = clinicalStatus[scheme][level];
    expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5);
    for (const s of surfaces) expect(contrastRatio(text, s)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LEVELS)("%s solid is at least 3:1 on every surface", (level) => {
    for (const s of surfaces) expect(contrastRatio(clinicalStatus[scheme][level].solid, s)).toBeGreaterThanOrEqual(3);
  });

  it("normal green is never the brand green", () => {
    for (const hex of Object.values(clinicalStatus[scheme].normal)) expect(hex.toUpperCase()).not.toBe(palette.brand.toUpperCase());
  });
});

describe("mobile clinical status matches the web tokens", () => {
  const webSource = readFileSync(join(__dirname, "../../../../../packages/ui/src/tokens.ts"), "utf8");
  const start = webSource.indexOf("export const clinicalStatusColors");
  const block = webSource.slice(start, webSource.indexOf("\n};", start));

  function webTone(scheme: Scheme, level: ClinicalStatusLevel): { solid: string; text: string; tint: string } {
    const schemeStart = block.indexOf(`${scheme}: {`);
    const line = new RegExp(`${level}:\\s*\\{\\s*solid:\\s*"(#[0-9A-Fa-f]{6})",\\s*text:\\s*"(#[0-9A-Fa-f]{6})",\\s*tint:\\s*"(#[0-9A-Fa-f]{6})"`).exec(
      block.slice(schemeStart),
    );
    if (schemeStart < 0 || !line) throw new Error(`web status token ${scheme}.${level} not found`);
    return { solid: line[1].toUpperCase(), text: line[2].toUpperCase(), tint: line[3].toUpperCase() };
  }

  for (const scheme of SCHEMES)
    it.each(LEVELS)(`${scheme} %s equals the web value`, (level) => {
      const mobile = clinicalStatus[scheme][level];
      expect({ solid: mobile.solid.toUpperCase(), text: mobile.text.toUpperCase(), tint: mobile.tint.toUpperCase() }).toEqual(
        webTone(scheme, level),
      );
    });
});
