/**
 * The legacy `colors` object still drives every screen that has not moved onto
 * the kit. `subtle` is the AA-safe tertiary text colour used in place of `faint`
 * wherever the colour is text or a placeholder; `faint` stays for decorative marks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { colors } from "./theme";
import { contrastRatio } from "./design/tokens";

describe("legacy colors.subtle", () => {
  it.each([colors.card, colors.background, colors.groupBg, colors.pressed])("is at least 4.5:1 on %s", (background) => {
    expect(contrastRatio(colors.subtle, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("colors.faint fails AA as text, which is why it is no longer used for text", () => {
    expect(contrastRatio(colors.faint, colors.card)).toBeLessThan(4.5);
  });
});

describe("source guard: colors.faint is never used as text or a placeholder colour", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) files.push(full);
    }
  };
  walk(root);

  it("finds the screens it is meant to guard", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no `color: colors.faint` and no `placeholderTextColor={colors.faint}` anywhere in src", () => {
    const offenders = files.filter((f) => /color: colors\.faint\b|placeholderTextColor=\{colors\.faint\}/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
