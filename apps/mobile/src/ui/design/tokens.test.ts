/**
 * The design tokens are held to WCAG AA by test, not by eye: every text role must
 * reach 4.5 to 1 on every surface it can sit on, in both palettes. A colour edit
 * that breaks contrast fails here. (Large text needs 3 to 1; we hold all text to
 * the stricter 4.5 so a variant change cannot silently drop below it.)
 */
import { contrastRatio, darkPalette, lightPalette, palettes, radii, space, type Palette } from "./tokens";
import { DARK_MODE_ENABLED, DEFAULT_PREFERENCE } from "./config";
import { resolveScheme } from "./resolve";
import { textStyles } from "./typography";

const SURFACES: (keyof Palette)[] = ["canvas", "surface", "surfaceMuted"];
const TEXT_ROLES: (keyof Palette)[] = ["text", "textMuted", "textSubtle", "brandText", "warnText", "dangerText"];

describe.each([
  ["light", lightPalette],
  ["dark", darkPalette],
] as const)("%s palette contrast", (_name, palette) => {
  for (const role of TEXT_ROLES) {
    for (const surface of SURFACES) {
      it(`${role} on ${surface} is at least 4.5:1`, () => {
        expect(contrastRatio(palette[role], palette[surface])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white text on the brand fill and on the pressed fill is at least 4.5:1", () => {
    expect(contrastRatio(palette.textOnBrand, palette.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.textOnBrand, palette.brandPressed)).toBeGreaterThanOrEqual(4.5);
  });

  it("emergency text is at least 4.5:1 on the emergency red", () => {
    expect(contrastRatio(palette.textOnEmergency, palette.emergency)).toBeGreaterThanOrEqual(4.5);
  });

  it("amber and red text are at least 4.5:1 on their own soft backgrounds", () => {
    expect(contrastRatio(palette.warnText, palette.warnBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.dangerText, palette.dangerBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring is visible (3:1) against the canvas and the surface", () => {
    expect(contrastRatio(palette.focus, palette.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.focus, palette.surface)).toBeGreaterThanOrEqual(3);
  });

  it("the card border is distinguishable from the canvas", () => {
    expect(contrastRatio(palette.border, palette.canvas)).toBeGreaterThan(1.05);
  });
});

describe("palettes", () => {
  it("light and dark define exactly the same roles", () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort());
    expect(palettes.light).toBe(lightPalette);
    expect(palettes.dark).toBe(darkPalette);
  });

  it("every colour is a hex or an rgba value, never a name", () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const value of Object.values(palette)) expect(value).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/);
    }
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#0E7C52", "#0E7C52")).toBeCloseTo(1, 5);
  });
});

describe("typography and spacing", () => {
  it("text never goes below 12, reading text has generous lines, display text is allowed tighter ones", () => {
    for (const style of Object.values(textStyles)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(12);
      const minRatio = style.fontSize <= 16 ? 1.3 : 1.1;
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * minRatio);
    }
  });

  it("headline sizes step down in order", () => {
    const order = ["hero", "stat", "headline", "title", "bodyLarge", "body", "label", "caption"] as const;
    const sizes = order.map((v) => textStyles[v].fontSize);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
  });

  it("spacing and radii are on a 4 point grid or a named exception", () => {
    for (const value of Object.values(space)) expect(value % 2).toBe(0);
    expect(radii.pill).toBeGreaterThan(100);
  });
});

describe("resolveScheme", () => {
  it("is always light while dark mode is switched off, whatever the preference or system says", () => {
    expect(resolveScheme("dark", "dark", false)).toBe("light");
    expect(resolveScheme("system", "dark", false)).toBe("light");
  });

  it("with dark mode on, an explicit preference wins and 'system' follows the OS", () => {
    expect(resolveScheme("light", "dark", true)).toBe("light");
    expect(resolveScheme("dark", "light", true)).toBe("dark");
    expect(resolveScheme("system", "dark", true)).toBe("dark");
    expect(resolveScheme("system", "light", true)).toBe("light");
    expect(resolveScheme("system", null, true)).toBe("light");
  });

  it("ships dark mode opt-in: available, but light until a patient chooses it (decision DG-2, 2026-10-03)", () => {
    expect(DARK_MODE_ENABLED).toBe(true);
    expect(DEFAULT_PREFERENCE).toBe("light");
  });
});
