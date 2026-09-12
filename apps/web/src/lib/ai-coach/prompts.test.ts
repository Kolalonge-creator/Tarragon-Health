import { describe, expect, it } from "@jest/globals";
import {
  COACH_SYSTEM_PROMPT,
  DISCLAIMER_LINE,
  EMERGENCY_SAFETY_REPLY,
  COACH_UNAVAILABLE_REPLY,
} from "./prompts";

/**
 * DISCLAIMER_LINE, EMERGENCY_SAFETY_REPLY and COACH_UNAVAILABLE_REPLY are
 * fixed, hand-written copy sent verbatim to patients (never phrased by the
 * model) and all three used to contain an em dash, violating the standing
 * "no em dashes in patient-facing text" copy rule (see
 * emergency-guidance.test.ts for the same rule enforced elsewhere). Locking
 * these here since a future edit to this hand-written copy could easily
 * reintroduce one.
 */
describe("AI Coach fixed patient-facing copy", () => {
  it.each([
    ["DISCLAIMER_LINE", DISCLAIMER_LINE],
    ["EMERGENCY_SAFETY_REPLY", EMERGENCY_SAFETY_REPLY],
    ["COACH_UNAVAILABLE_REPLY", COACH_UNAVAILABLE_REPLY],
  ])("%s uses no em dashes", (_name, line) => {
    expect(line).not.toContain("—");
  });

  it("instructs the model to never use an em dash in its own reply", () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/never use the em dash character/i);
  });
});
