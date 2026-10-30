import { describe, expect, it } from "@jest/globals";
import { FIELD_STEP, parseRiskAssessmentFormData, riskAssessmentSchema } from "./risk-assessment";

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

  /**
   * 2026-10-30, first live sign-up: a patient pressed Next with the smoking and height boxes empty and was shown
   * `Invalid option: expected one of "never"|"former"|"current"` and `Invalid input: expected number, received NaN`.
   * Every message a patient can see here must say what to do, and none may be the raw checker wording.
   */
  it("says in plain words what to do when an answer is missing", () => {
    const fd = validFormData();
    for (const key of ["smoking_status", "alcohol_use", "sleep_hours", "stress_level", "height_cm", "exercise_days_per_week", "exercise_minutes_per_session"]) fd.delete(key);
    const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(fd));
    if (parsed.success) throw new Error("expected validation to fail");
    const messages = parsed.error.issues.map((i) => i.message);
    expect(messages.length).toBeGreaterThanOrEqual(7);
    for (const m of messages) {
      expect(m).not.toMatch(/Invalid (option|input)|expected (one of|number)|received/i);
      expect(m.length).toBeGreaterThan(15);
    }
  });

  it("names the field and the step of the first missing answer", () => {
    const fd = validFormData();
    fd.delete("smoking_status");
    const parsed = riskAssessmentSchema.safeParse(parseRiskAssessmentFormData(fd));
    if (parsed.success) throw new Error("expected validation to fail");
    const field = String(parsed.error.issues[0]?.path[0]);
    expect(field).toBe("smoking_status");
    expect(FIELD_STEP[field]).toBe(2);
  });

  it("knows the step of every field the form asks for", () => {
    for (const key of Object.keys(parseRiskAssessmentFormData(validFormData()))) {
      if (key.startsWith("family_") && !key.startsWith("family_cancer")) continue; // plain ticks, never an error
      expect(FIELD_STEP[key]).toBeDefined();
    }
  });
});
