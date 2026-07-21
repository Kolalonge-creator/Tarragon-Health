import { describe, it, expect } from "@jest/globals";
import { toneGuard } from "./index";

describe("toneGuard (spec §10.3 / §18.6, §18.9)", () => {
  it("passes person-first, supportive copy", () => {
    expect(toneGuard("Nice work logging today — small steps add up.").ok).toBe(true);
  });

  it("blocks stigmatising terms toward the patient", () => {
    expect(toneGuard("Great job losing weight, you were so lazy before!").ok).toBe(false);
    expect(toneGuard("You failed your goal this week.").violations).toContain("deny_term:failed");
  });

  it("blocks bot clinical reassurance", () => {
    const r = toneGuard("Your blood pressure is fine, nothing to worry about.");
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(1);
  });

  it("does not false-positive on unrelated words", () => {
    expect(toneGuard("Here is a prefatory note about your plan.").ok).toBe(true);
  });
});
