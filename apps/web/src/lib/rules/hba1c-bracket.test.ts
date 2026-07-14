import { describe, expect, it } from "@jest/globals";
import { getHba1cBracket, formatHba1cWithBracket } from "./hba1c-bracket";

describe("getHba1cBracket", () => {
  it("labels values under 5.7 as Normal", () => {
    expect(getHba1cBracket(5.2).label).toBe("Normal");
    expect(getHba1cBracket(5.69).label).toBe("Normal");
  });

  it("labels 5.7-6.4 as Prediabetic range", () => {
    expect(getHba1cBracket(5.7).label).toBe("Prediabetic range");
    expect(getHba1cBracket(6.4).label).toBe("Prediabetic range");
  });

  it("labels 6.5 and above as Diabetic range", () => {
    expect(getHba1cBracket(6.5).label).toBe("Diabetic range");
    expect(getHba1cBracket(9.0).label).toBe("Diabetic range");
  });
});

describe("formatHba1cWithBracket", () => {
  it("formats the real value with its bracket in parentheses", () => {
    expect(formatHba1cWithBracket(5.9)).toBe("5.9% (Prediabetic range)");
  });
});
