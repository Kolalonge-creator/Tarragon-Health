import type { Enums } from "@tarragon/shared";

/**
 * Cross-programme chronic-disease intersections (§44.14): hypertension,
 * diabetes, obesity and cardiovascular disease can each interact with
 * pregnancy, contraception and menopause. Pure, no DB access — callers pass
 * in the patient's active care_plans conditions (already read from the DB)
 * and get back plain-language caution copy, generalising the existing
 * diabetes-in-pregnancy banner (pregnancy-status.tsx) to the other three
 * conditions rather than special-casing diabetes alone.
 */

export type CarePlanCondition = Enums<"care_plan_condition">;

const PREGNANCY_LED_CONDITIONS: CarePlanCondition[] = ["diabetes", "hypertension"];
const CONTRACEPTION_CAUTION_CONDITIONS: CarePlanCondition[] = ["hypertension", "cardiovascular"];
const MENOPAUSE_TREATMENT_CAUTION_CONDITIONS: CarePlanCondition[] = ["hypertension", "cardiovascular"];

const CONDITION_LABEL: Partial<Record<CarePlanCondition, string>> = {
  diabetes: "diabetes",
  hypertension: "blood pressure",
  obesity: "weight",
  cardiovascular: "cardiovascular",
};

/** §20.2-style guard: an active condition that means pregnancy care is obstetric-led. */
export function pregnancyLedCareBanner(activeConditions: CarePlanCondition[]): string | null {
  const led = activeConditions.filter((c) => PREGNANCY_LED_CONDITIONS.includes(c));
  if (led.length === 0) return null;
  const labels = led.map((c) => CONDITION_LABEL[c] ?? c).join(" and ");
  return `Your ${labels} care in pregnancy is led by antenatal care. Please make sure you're booked into antenatal care; your Tarragon team will help coordinate and stay in touch, but won't manage this on its own during pregnancy. Some medications are usually reviewed in pregnancy, so don't change anything without your antenatal team.`;
}

/** A caution to show alongside the contraception method self-report. */
export function contraceptionCautionNote(activeConditions: CarePlanCondition[]): string | null {
  const flagged = activeConditions.filter((c) => CONTRACEPTION_CAUTION_CONDITIONS.includes(c));
  if (flagged.length === 0) return null;
  return "Some contraceptive methods (especially combined hormonal ones) need extra care alongside a blood pressure or cardiovascular condition — mention your current method at your next review so your care team can check it's still a good fit.";
}

/** A caution to show alongside menopause symptom tracking / HRT discussion. */
export function menopauseTreatmentCautionNote(activeConditions: CarePlanCondition[]): string | null {
  const flagged = activeConditions.filter((c) => MENOPAUSE_TREATMENT_CAUTION_CONDITIONS.includes(c));
  if (flagged.length === 0) return null;
  return "Menopause treatment options (including HRT) are weighed differently alongside a blood pressure or cardiovascular condition — this is worth discussing directly with your care team rather than starting anything on your own.";
}
