import { describe, expect, it } from "@jest/globals";
import { mgDlToMmolL } from "@tarragon/shared";
import { isAboveLine, isBelowLine, wholeMgDl } from "./bands";

describe("glucose lines are judged in whole mg/dL", () => {
  it("181 mg/dL is above the 10.0 mmol/L line and 180 is not, though both round to 10.0 at one decimal", () => {
    expect(isAboveLine(mgDlToMmolL(181), 10.0)).toBe(true);
    expect(isAboveLine(mgDlToMmolL(180), 10.0)).toBe(false);
  });
  it("69 mg/dL is below the 3.9 mmol/L line and 70 is not", () => {
    expect(isBelowLine(mgDlToMmolL(69), 3.9)).toBe(true);
    expect(isBelowLine(mgDlToMmolL(70), 3.9)).toBe(false);
  });
  it("a mmol/L sensor's tenths land on the same side: 3.9 and 10.0 are on the line, 3.8 below, 10.1 above", () => {
    expect(isBelowLine(3.9, 3.9)).toBe(false);
    expect(isAboveLine(10.0, 10.0)).toBe(false);
    expect(isBelowLine(3.8, 3.9)).toBe(true);
    expect(isAboveLine(10.1, 10.0)).toBe(true);
  });
  it("converts to whole mg/dL", () => {
    expect(wholeMgDl(5.5)).toBe(99);
  });
});
