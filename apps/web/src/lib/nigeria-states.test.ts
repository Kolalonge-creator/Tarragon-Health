import {
  NIGERIAN_STATES,
  canonicalizeNigerianState,
  isRecognizedNigerianState,
  normalizeNigerianStateKey,
} from "./nigeria-states";

describe("normalizeNigerianStateKey", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeNigerianStateKey("  LAGOS   STATE ")).toBe("lagos");
  });

  it("strips a trailing 'state' suffix", () => {
    expect(normalizeNigerianStateKey("Akwa Ibom State")).toBe("akwa ibom");
    expect(normalizeNigerianStateKey("Cross River")).toBe("cross river");
  });

  it("folds common FCT/Abuja spellings", () => {
    expect(normalizeNigerianStateKey("FCT")).toBe("abuja");
    expect(normalizeNigerianStateKey("Federal Capital Territory")).toBe("abuja");
    expect(normalizeNigerianStateKey("Abuja")).toBe("abuja");
  });

  it("returns null for blank/null/undefined input", () => {
    expect(normalizeNigerianStateKey(null)).toBeNull();
    expect(normalizeNigerianStateKey(undefined)).toBeNull();
    expect(normalizeNigerianStateKey("   ")).toBeNull();
  });

  it("does not collide unrelated strings", () => {
    expect(normalizeNigerianStateKey("United Kingdom")).not.toBe(normalizeNigerianStateKey("Lagos"));
  });
});

describe("canonicalizeNigerianState", () => {
  it("passes an already-canonical value through unchanged", () => {
    expect(canonicalizeNigerianState("Lagos")).toBe("Lagos");
  });

  it("resolves a casing/whitespace/'...State'-suffix variant to the canonical spelling", () => {
    expect(canonicalizeNigerianState("lagos state")).toBe("Lagos");
    expect(canonicalizeNigerianState("  RIVERS  ")).toBe("Rivers");
    expect(canonicalizeNigerianState("Akwa Ibom State")).toBe("Akwa Ibom");
  });

  it("resolves FCT aliases to the seeded 'Abuja' spelling", () => {
    expect(canonicalizeNigerianState("FCT")).toBe("Abuja");
  });

  it("every canonical NIGERIAN_STATES value is a fixed point", () => {
    for (const s of NIGERIAN_STATES) {
      expect(canonicalizeNigerianState(s.value)).toBe(s.value);
    }
  });

  it("leaves a genuinely non-Nigerian value unchanged rather than guessing", () => {
    expect(canonicalizeNigerianState("United Kingdom")).toBe("United Kingdom");
  });

  it("returns an empty string for blank/null/undefined/whitespace-only input", () => {
    expect(canonicalizeNigerianState(null)).toBe("");
    expect(canonicalizeNigerianState(undefined)).toBe("");
    expect(canonicalizeNigerianState("")).toBe("");
    // Regression: a whitespace-only string is truthy in JS, so an early `if (!value)`
    // check alone doesn't catch it — must go through normalizeNigerianStateKey first.
    expect(canonicalizeNigerianState("   ")).toBe("");
  });
});

describe("isRecognizedNigerianState", () => {
  it("is true for a canonical value and a normalizable variant", () => {
    expect(isRecognizedNigerianState("Lagos")).toBe(true);
    expect(isRecognizedNigerianState("lagos state")).toBe(true);
    expect(isRecognizedNigerianState("FCT")).toBe(true);
  });

  it("is false for a genuinely unrecognized value, blank, null, or undefined", () => {
    expect(isRecognizedNigerianState("United Kingdom")).toBe(false);
    expect(isRecognizedNigerianState("")).toBe(false);
    expect(isRecognizedNigerianState("   ")).toBe(false);
    expect(isRecognizedNigerianState(null)).toBe(false);
    expect(isRecognizedNigerianState(undefined)).toBe(false);
  });
});
