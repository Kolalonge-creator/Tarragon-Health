import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

const src = readFileSync(join(__dirname, "Disclosure.tsx"), "utf8");

describe("kit Disclosure", () => {
  it("tells a screen reader whether it is open", () => {
    expect(src).toMatch(/accessibilityState=\{\{ expanded: open \}\}/);
    expect(src).toMatch(/accessibilityRole="button"/);
  });

  it("has a touch target of at least 44 points", () => {
    const m = src.match(/minHeight: (\d+)/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  it("keeps folded content mounted so a half-typed form keeps its text", () => {
    expect(src).toMatch(/display: open \? "flex" : "none"/);
    expect(src).not.toMatch(/\{open \? <View/);
  });
});
