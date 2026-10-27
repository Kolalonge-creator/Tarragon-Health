import { readFileSync } from "fs";
import { join } from "path";

/**
 * Touch targets (spec D.2, WCAG 2.2 and Apple's 44 point minimum, audit D1-D2 item 23). The new kit meets it through MIN_TARGET; this pins the
 * legacy buttons that did not (the secondary button and the choice chip came to about 33 points) and the one small text button that was
 * reached by the audit, so they cannot quietly shrink again. Static, like a11y-scan.test.ts: it cannot measure a rendered screen.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

function body(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport function ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("legacy buttons meet the 44 point minimum", () => {
  const kit = read("legacy-kit.tsx");
  it("imports the shared minimum rather than a private number", () => {
    expect(kit).toMatch(/import \{[^}]*MIN_TARGET[^}]*\} from "\.\/design"/);
  });
  for (const name of ["PrimaryButton", "SecondaryButton", "ChoiceChip"]) {
    it(`${name} cannot be shorter than MIN_TARGET`, () => {
      const src = body(kit, name);
      // The primary button already clears it by padding (14 + 14 + a 16 point line); the others must say so.
      if (name === "PrimaryButton") expect(src).toMatch(/paddingVertical: 14/);
      else expect(src).toMatch(/minHeight: MIN_TARGET/);
    });
  }
  it("the medicine cabinet's small text button has a 44 point minimum height", () => {
    const src = read("../screens/sections/medicine-cabinet-screen.tsx");
    const i = src.indexOf("function SmallGhostButton(");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 900)).toMatch(/minHeight: 44/);
  });
  it("SABOTAGE: with the minimum removed from the real source, the same check fails", () => {
    const real = body(kit, "SecondaryButton");
    expect(real).toMatch(/minHeight: MIN_TARGET/);
    const sabotaged = real.replace("minHeight: MIN_TARGET,", "");
    expect(sabotaged).not.toMatch(/minHeight: MIN_TARGET/);
  });
});

describe("text scaling (WCAG 2.2: usable at 200 percent)", () => {
  it("the top bar title scales fully; the smaller caps that remain are listed so they are decided, not forgotten", () => {
    const top = read("top-bar.tsx");
    expect(top).toMatch(/maxFontSizeMultiplier=\{MAX_FONT_SCALE\} numberOfLines=\{1\}/);
    // Still capped at 1.2 on purpose (a fixed circle and a count badge that cannot grow without clipping); tracked in OQ-732.
    expect((top.match(/maxFontSizeMultiplier=\{1\.2\}/g) ?? []).length).toBe(2);
  });
});
