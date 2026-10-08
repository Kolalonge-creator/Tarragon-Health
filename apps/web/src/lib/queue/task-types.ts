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
  adherence_follow_up: "Adherence follow-up (missed doses or silence)",
  health_report_signoff: "Yearly health report sign-off",
};

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
