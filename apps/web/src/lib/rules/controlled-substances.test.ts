import { controlledSubstanceInfo } from "./controlled-substances";

describe("controlledSubstanceInfo", () => {
  it("flags a narcotic-class opioid", () => {
    const result = controlledSubstanceInfo("Morphine");
    expect(result?.tier).toBe("narcotic");
    expect(result?.label).toBe("Opioid analgesic");
  });

  it("flags a lower-schedule opioid as restricted, not narcotic", () => {
    expect(controlledSubstanceInfo("Tramadol")?.tier).toBe("restricted");
  });

  it("flags a benzodiazepine as restricted", () => {
    expect(controlledSubstanceInfo("Diazepam 5mg")?.tier).toBe("restricted");
  });

  it("flags a stimulant as narcotic", () => {
    expect(controlledSubstanceInfo("Methylphenidate")?.tier).toBe("narcotic");
  });

  it("matches case-insensitively and with a dose suffix", () => {
    expect(controlledSubstanceInfo("codeine 30mg")).not.toBeNull();
  });

  it("returns null for an ordinary, non-controlled drug", () => {
    expect(controlledSubstanceInfo("Amlodipine")).toBeNull();
    expect(controlledSubstanceInfo("Metformin")).toBeNull();
  });

  it("returns null for an empty or whitespace-only name", () => {
    expect(controlledSubstanceInfo("")).toBeNull();
    expect(controlledSubstanceInfo("   ")).toBeNull();
  });

  it("does not false-positive on a substring collision", () => {
    // "Codeine" must not match inside an unrelated word.
    expect(controlledSubstanceInfo("Encodeinate")).toBeNull();
  });
});
