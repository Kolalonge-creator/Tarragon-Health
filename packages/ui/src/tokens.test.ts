import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brandColors, brandCssVars, type BrandColorName } from "./tokens";

describe("design tokens", () => {
  it("pins the two brand anchors from the brand guide", () => {
    expect(brandColors.tarragonGreen).toBe("#0E7C52");
    expect(brandColors.clinicalNavy).toBe("#12324B");
  });

  it("are valid 6 digit hex colours", () => {
    for (const hex of Object.values(brandColors)) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("match the CSS custom properties in apps/web globals.css", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../../../apps/web/src/app/globals.css", import.meta.url)),
      "utf8",
    );
    for (const name of Object.keys(brandColors) as BrandColorName[]) {
      const v = brandCssVars[name].replace(/[-]/g, "\\-");
      const m = css.match(new RegExp(`${v}:\\s*(#[0-9a-fA-F]{6})`));
      expect([name, m?.[1]?.toUpperCase()]).toEqual([name, brandColors[name]]);
    }
  });
});
