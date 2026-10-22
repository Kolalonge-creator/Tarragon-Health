import { z } from "zod";

/** One active row of `task_types` (S16): what kinds of clinician work exist, how urgent each is and who may take it. */
export const taskTypeSchema = z.object({
  code: z.string(),
  priority_class: z.number().int().min(1).max(9),
  default_due_minutes: z.number().int().min(0),
  min_doctor_tier: z.enum(["care_coordinator", "senior_medical_officer", "chief_medical_officer"]),
  required_competencies: z.array(z.string()),
  lead_window_minutes: z.number().int().min(0),
  claim_timeout_minutes: z.number().int().min(1),
  pushable: z.boolean(),
  creatable: z.boolean(),
  source_task_keys: z.array(z.string()),
  note: z.string().nullable(),
  needs_confirmation: z.boolean(),
  confirmed_at: z.string().nullable(),
  confirmation_note: z.string().nullable(),
});
export type TaskTypeRow = z.infer<typeof taskTypeSchema>;

/** Plain-language names for the codes, so people can search and read them. Unknown codes fall back to the code itself. */
export const TASK_TYPE_LABEL: Readonly<Record<string, string>> = {
  red_event_unacknowledged: "Red event not acknowledged",
  critical_result_review: "Critical result review",
  amber_bp_review_due_soon: "Amber blood pressure review, due soon",
  amber_bp_review: "Amber blood pressure review",
  symptom_review: "Symptom review",
  titration_signoff: "Dose adjustment sign-off",
  async_question: "Written question",
  routine_result_review: "Routine result review",
  admin_clinical: "Referral letters and repeat prescriptions",
  pharmacy_flag_review: "Pharmacy flag on a prescription",
  crisis_follow_up: "Crisis follow-up (wellbeing check-in)",
  adherence_follow_up: "Adherence follow-up (missed doses or silence)",
  health_report_signoff: "Yearly health report sign-off",
  home_bp_check_review: "Home blood pressure check review",
  bp_pattern_review: "Blood pressure pattern for review (clinic and home differ)",
  red_patient_outreach: "Call the patient: a red alert was not confirmed",
  amber_glucose_review: "Urgent glucose review (same day)",
};

/**
 * Skills the database adds to a task on top of the type's own list (`private.task_extra_competencies`, OQ-433). They are not on the
 * `task_types` row, so the page states them here. A Jest test reads the SQL function and fails if this drifts from it.
 */
export const ALWAYS_EXTRA_SKILLS: Readonly<Record<string, readonly string[]>> = {
  pharmacy_flag_review: ["prescribing"],
};

/** A skill added only for part of a type's work, said in words. */
export const SOMETIMES_EXTRA_SKILLS_NOTE: Readonly<Record<string, string>> = {
  admin_clinical: "Prescribing, when the work is a prescription",
};

/** The skills line of a task type: its own list plus the ones the database always adds. */
export function skillsNeeded(t: Pick<TaskTypeRow, "code" | "required_competencies">): string {
  const all = [...new Set([...t.required_competencies, ...(ALWAYS_EXTRA_SKILLS[t.code] ?? [])])].sort();
  return all.length > 0 ? all.join(", ").replace(/_/g, " ") : "None specific";
}

/** Work a type receives that the triage keys do not show (OQ-432): the symptom checker asks for a clinician review. */
export const EXTRA_PRODUCER_NOTE: Readonly<Record<string, string>> = {
  symptom_review: "A Member's symptom check that asks for a clinician review, and a Member's own request for one",
};

/** Said once on the page: a named clinician who lacks a needed skill is skipped when the work is offered (OQ-435). */
export const LEAD_SKIP_EXPLANATION =
  "If the named clinician does not hold every skill the work needs, they are not offered it. Work that can be offered to an employed doctor goes to one who does; everything else goes to the pool. The task history says why.";

export const TIER_LABEL: Readonly<Record<TaskTypeRow["min_doctor_tier"], string>> = {
  care_coordinator: "Care coordinator and above",
  senior_medical_officer: "Senior medical officer and above",
  chief_medical_officer: "Chief medical officer",
};

export function formatMinutes(minutes: number): string {
  if (minutes === 0) return "None";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

/** Words people may type for a task type, used by the console search. */
export function taskTypeSearchWords(code: string): string {
  return `${code} ${code.replace(/_/g, " ")} ${TASK_TYPE_LABEL[code] ?? ""}`.trim();
}
