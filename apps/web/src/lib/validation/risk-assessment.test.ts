import { describe, expect, it } from "@jest/globals";
import { parseRiskAssessmentFormData, riskAssessmentSchema } from "./risk-assessment";

/** A fully valid submission's FormData, used as the base for each test so
 *  only the field under test deviates. */
function validFormData(overrides: Record<string, string | string[]> = {}) {
  const fd = new FormData();
  const fields: Record<string, string | string[]> = {
    smoking_status: "never",
    alcohol_use: "none",
    exercise_days_per_week: "3",
    exercise_minutes_per_session: "30",
    sleep_hours: "7_to_8",
    stress_level: "low",
    height_cm: "170",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
  }
  return fd;
}

describe("parseRiskAssessmentFormData + riskAssessmentSchema", () => {
  it("accepts a fully answered Lifestyle step", () => {
    const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(validFormData()));
    expect(parsed.success).toBe(true);
  });

  /**
   * Regression test for a bug found 2026-09-18 in a live UX audit, right
   * after fixing a separate bug that let the whole risk-assessment form
   * reach the server with the Lifestyle step blank (previously the browser
   * silently refused to submit at all — see RiskAssessmentForm's
   * `noValidate` fix). exercise_days_per_week/exercise_minutes_per_session/
   * height_cm are `z.coerce.number()` fields: `Number("")` is `0`, which
   * passes every one of these fields' own min()/max() bounds, so a blank
   * field was silently recorded as real "0 exercise days, 0 minutes, 0cm
   * tall" data — feeding a fabricated risk factor into
   * lib/rules/risk-scoring.ts — instead of failing validation the way an
   * unanswered required field should. Each of these three fields must fail
   * validation when submitted blank, not silently coerce to a valid 0.
   */
  it.each(["exercise_days_per_week", "exercise_minutes_per_session", "height_cm"] as const)(
    "rejects a blank %s instead of silently coercing it to a valid value",
    (field) => {
      const fd = validFormData({ [field]: "" });
      const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(fd));
      expect(parsed.success).toBe(false);
    }
  );

  it("does not silently record 0 exercise days when the field is blank", () => {
    // The specific failure mode: before the fix, this succeeded with
    // exercise_days_per_week coerced to 0 rather than being rejected.
    const fd = validFormData({ exercise_days_per_week: "" });
    const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(fd));
    if (parsed.success) {
      // Fails loudly (rather than just `success: false`) so a future reader
      // sees exactly what silently slipped through.
      throw new Error(
        `expected validation to fail, but exercise_days_per_week was silently accepted as ${parsed.data.exercise_days_per_week}`
      );
    }
  });
});
