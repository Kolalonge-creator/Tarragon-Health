import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  brandColors,
  brandCssVars,
  CLINICAL_STATUS_LEVELS,
  clinicalStatusColors,
  contrastRatio,
  statusCssVar,
  type BrandColorName,
  type ClinicalStatusRole,
  type StatusTheme,
} from "./tokens";
import { LEGACY_STATUS_COLOUR, STATUS_CLASSES } from "./status";

const themeCss = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");

/** Surfaces a status colour can sit on in each theme: white card and Warm
 * Ivory canvas (light); night card and night ground (dark). */
const SURFACES: Record<StatusTheme, string[]> = {
  light: ["#FFFFFF"],
  dark: ["#221C15", "#17130E"],
};

/** The [data-theme="dark"] block of theme.css, where the night values live. */
function darkBlock(css: string): string {
  const start = css.indexOf('[data-theme="dark"] {');
  if (start < 0) throw new Error("no [data-theme=\"dark\"] block in theme.css");
  return css.slice(start, css.indexOf("}", start));
}

/** The first :root block, where the light values live. */
function lightBlock(css: string): string {
  const start = css.indexOf(":root {");
  return css.slice(start, css.indexOf("}", start));
}

function cssHex(block: string, name: string): string | undefined {
  // Escape every regex metacharacter (CodeQL: escaping only "-" left backslashes and the rest unescaped).
  const escaped = name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const m = block.match(new RegExp(`${escaped}:\\s*(#[0-9a-fA-F]{6})`));
  return m?.[1]?.toUpperCase();
}

const ROLES: ClinicalStatusRole[] = ["solid", "text", "tint"];
const THEMES: StatusTheme[] = ["light", "dark"];

describe("clinical status tokens", () => {
  it("has exactly the six levels", () => {
    expect([...CLINICAL_STATUS_LEVELS]).toEqual(["critical", "urgent", "attention", "normal", "info", "inactive"]);
    for (const theme of THEMES) expect(Object.keys(clinicalStatusColors[theme]).sort()).toEqual([...CLINICAL_STATUS_LEVELS].sort());
  });

  it("are valid 6 digit hex colours", () => {
    for (const theme of THEMES)
      for (const level of CLINICAL_STATUS_LEVELS)
        for (const role of ROLES) expect(clinicalStatusColors[theme][level][role]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("match theme.css in light (:root) and dark ([data-theme=dark])", () => {
    const blocks: Record<StatusTheme, string> = { light: lightBlock(themeCss), dark: darkBlock(themeCss) };
    for (const theme of THEMES)
      for (const level of CLINICAL_STATUS_LEVELS)
        for (const role of ROLES) {
          const name = statusCssVar(level, role);
          expect([theme, name, cssHex(blocks[theme], name)]).toEqual([theme, name, clinicalStatusColors[theme][level][role]]);
          // ...and Tailwind can see it as a theme colour.
          expect(themeCss).toContain(`--color-status-${name.slice("--status-".length)}: var(${name});`);
        }
  });

  it("defines clinical-amber as the attention level", () => {
    expect(themeCss).toContain("--color-clinical-amber: var(--status-attention);");
  });

  describe.each(THEMES)("%s contrast (WCAG AA)", (theme) => {
    it.each([...CLINICAL_STATUS_LEVELS])("%s text is at least 4.5:1 on its own tint and on every surface", (level) => {
      const { text, tint } = clinicalStatusColors[theme][level];
      expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5);
      for (const surface of SURFACES[theme]) expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
    });

    it.each([...CLINICAL_STATUS_LEVELS])("%s solid is at least 3:1 on every surface (non-text contrast)", (level) => {
      for (const surface of SURFACES[theme])
        expect(contrastRatio(clinicalStatusColors[theme][level].solid, surface)).toBeGreaterThanOrEqual(3);
    });

    it("white text on the critical fill is at least 4.5:1 (the emergency tile)", () => {
      expect(contrastRatio("#FFFFFF", clinicalStatusColors[theme].critical.solid)).toBeGreaterThanOrEqual(4.5);
    });

    it("normal green is not the brand green", () => {
      const normal = clinicalStatusColors[theme].normal;
      for (const hex of Object.values(normal)) {
        expect(hex).not.toBe(brandColors.tarragonGreen);
        expect(hex).not.toBe(brandColors.deepForest);
      }
    });
  });

  it("the contrast helper matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("the class map uses only status utilities, and the colour aliases map to the expected levels", () => {
    for (const level of CLINICAL_STATUS_LEVELS)
      for (const cls of Object.values(STATUS_CLASSES[level])) expect(cls).toMatch(new RegExp(`-status-${level}(-text|-tint)?(/\\d+)?$`));
    expect(LEGACY_STATUS_COLOUR).toEqual({ red: "critical", amber: "attention", blue: "info", grey: "inactive", green: "normal" });
  });
});

describe("design tokens", () => {
  it("pins the two brand anchors from the brand guide", () => {
    expect(brandColors.tarragonGreen).toBe("#0E7C52");
    expect(brandColors.clinicalNavy).toBe("#12324B");
  });

  it("are valid 6 digit hex colours", () => {
    for (const hex of Object.values(brandColors)) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("match the CSS custom properties in the shared theme.css", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./theme.css", import.meta.url)),
      "utf8",
    );
    for (const name of Object.keys(brandColors) as BrandColorName[]) {
      const v = brandCssVars[name].replace(/[-]/g, "\\-");
      const m = css.match(new RegExp(`${v}:\\s*(#[0-9a-fA-F]{6})`));
      expect([name, m?.[1]?.toUpperCase()]).toEqual([name, brandColors[name]]);
    }
  });
});
