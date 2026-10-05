import { readFileSync } from "fs";
import { join } from "path";
import { MAX_FONT_SCALE, MIN_TARGET } from "./index";

describe("text scaling and touch targets", () => {
  it("lets text grow to at least 200 percent (WCAG 1.4.4)", () => {
    expect(MAX_FONT_SCALE).toBeGreaterThanOrEqual(2);
  });

  it("keeps every kit control at the 44 point minimum", () => {
    expect(MIN_TARGET).toBeGreaterThanOrEqual(44);
    for (const file of ["Chip.tsx", "SegmentedControl.tsx", "Button.tsx", "PressableScale.tsx"]) {
      const source = readFileSync(join(__dirname, "..", "kit", file), "utf8");
      const heights = [...source.matchAll(/minHeight:\s*(\d+)/g)].map((m) => Number(m[1]));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    }
  });
});
