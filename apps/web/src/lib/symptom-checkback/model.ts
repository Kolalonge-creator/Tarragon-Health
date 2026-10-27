import { z } from "zod";
import { symptomCaptureSchema, CARE_OPTIONS, CHECKBACK_ACTIONS, PROGRESS_OPTIONS } from "@tarragon/symptom-triage-engine";

/**
 * S59c: the shapes at the edge of the follow-up (check-back) feature. Everything that decides anything (own follow-up only, open only, the
 * decision table, the alert) happens in the database function; these schemas only validate what crosses the boundary.
 */
const uuid = z.string().uuid();

export const checkbackViewSchema = z.object({
  id: uuid,
  state: z.enum(["scheduled", "open", "answered", "expired", "cancelled"]),
  assessment_id: uuid,
  due_at: z.string(),
  opened_at: z.string().nullable(),
  category: z.enum(["self_management", "routine"]),
  urgency_level: z.string().nullable(),
  complaint_key: z.string(),
  complaint_label: z.string(),
  checked_at: z.string(),
  hours_since_check: z.number(),
  same_nudge_after_hours: z.number(),
  sign_vocabulary: z.array(z.string()),
  capture: symptomCaptureSchema,
  protocol_version: z.number(),
  outcome: z
    .object({
      action: z.enum(CHECKBACK_ACTIONS),
      progress: z.enum(PROGRESS_OPTIONS),
      escalated: z.boolean(),
      alert_raised: z.boolean().optional(),
      emergency: z.boolean().optional(),
      doctor_access: z.boolean().nullable().optional(),
    })
    .nullable(),
});
export type CheckbackView = z.infer<typeof checkbackViewSchema>;

export const answerInputSchema = z.object({
  checkbackId: uuid,
  progress: z.enum(PROGRESS_OPTIONS),
  care: z.enum(CARE_OPTIONS).nullable().optional(),
  signs: z.array(z.string().regex(/^[a-z0-9_]{1,60}$/)).max(10),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const answerOutcomeSchema = z.object({
  action: z.enum(CHECKBACK_ACTIONS),
  escalated: z.boolean(),
  alert_raised: z.boolean(),
  emergency: z.boolean(),
  doctor_access: z.boolean().nullable().optional(),
  assessment_id: uuid,
  repeat: z.boolean().optional(),
});
export type AnswerOutcome = z.infer<typeof answerOutcomeSchema>;

export type SubmitCheckbackResult =
  | { ok: true; outcome: AnswerOutcome; complaintKey: string }
  | { ok: false; reason: "invalid" | "signed_out" | "closed" | "not_open" | "failed" };
