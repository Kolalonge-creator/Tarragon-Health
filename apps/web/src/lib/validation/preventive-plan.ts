import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";

/**
 * T2 Phase 3: moving a screening test later (defer) and a doctor's decision on a new Member's preventive plan.
 * The database (defer_screening, review_preventive_plan) enforces the same rules; these give a clear message before the round trip.
 * The reason codes, the day limit and the note rules come from the versioned setting `screening.reminder_cadence` (T2-12),
 * never from a literal here.
 */

type DeferRules = { maxDaysAhead: number; maxPerSchedule: number; reasonCodes: string[]; noteRequiredFor: string[]; noteMaxChars: number };

export function deferRules(): DeferRules {
  const v = getProposedConfig<{ defer: DeferRules }>("screening.reminder_cadence").value;
  return v.defer;
}

export const DEFER_REASON_LABELS: Record<string, string> = {
  travelling: "I am travelling",
  unwell: "I am unwell at the moment",
  cost: "I cannot afford it yet",
  waiting_for_doctor_advice: "I am waiting for my doctor's advice",
  booked_for_later: "I have booked it for a later date",
  other: "Another reason",
};

function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(`${fromIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** today and dueDate are ISO dates (Africa/Lagos). */
export function deferScreeningSchema(today: string, dueDate: string) {
  const rules = deferRules();
  const latest = addDaysIso(today, rules.maxDaysAhead);
  const earliest = dueDate > today ? dueDate : today;
  return z
    .object({
      schedule_id: z.string().uuid(),
      new_due: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
        .refine((d) => d > earliest, "Choose a date later than the current due date")
        .refine((d) => d <= latest, `Choose a date within ${rules.maxDaysAhead} days`),
      reason_code: z.string().refine((c) => rules.reasonCodes.includes(c), "Choose a reason"),
      note: z.string().trim().max(rules.noteMaxChars).optional(),
    })
    .refine((v) => !rules.noteRequiredFor.includes(v.reason_code) || (v.note ?? "").length > 0, {
      message: "Tell us a little about the reason",
      path: ["note"],
    });
}

export const reviewPreventivePlanSchema = z
  .object({
    baseline_id: z.string().uuid(),
    decision: z.enum(["authorised", "adjusted"]),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== "adjusted" || (v.note ?? "").length >= 10, {
    message: "Say what you changed and why (at least 10 characters)",
    path: ["note"],
  });
export type ReviewPreventivePlanInput = z.infer<typeof reviewPreventivePlanSchema>;

/** The baseline items, as the patient reads them. Codes come from private.preventive_baseline_items. */
export const BASELINE_ITEM_LABELS: Record<string, { label: string; href: string }> = {
  risk_questionnaire: { label: "Health questionnaire (family, smoking, alcohol, lifestyle)", href: "/patient/prevention#risk-assessment" },
  blood_pressure: { label: "A blood pressure reading in the last 90 days", href: "/patient/vitals" },
  weight: { label: "Your weight in the last 90 days", href: "/patient/vitals" },
  height: { label: "Your height (for your BMI)", href: "/patient/profile" },
  waist: { label: "Your waist measurement in the last year", href: "/patient/vitals" },
  medical_history: { label: "Conditions you have been told you have", href: "/patient/health-history" },
  medicines: { label: "Medicines you take", href: "/patient/medications" },
  family_history: { label: "Illnesses in your close family", href: "/patient/health-history" },
  previous_tests: { label: "Tests you have had before", href: "/patient/health-records" },
};
