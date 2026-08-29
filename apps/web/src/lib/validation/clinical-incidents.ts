import { z } from "zod";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
} from "@/lib/clinical/incident-governance";

/**
 * Input contracts for the clinical incident / near-miss log (spec §31.7–§31.10).
 *
 * The category and severity enums are repeated here rather than derived from
 * the generated database types: these are the values a *form* may submit, and
 * a Zod enum is what turns an unexpected one into a friendly message instead
 * of a raw CHECK-constraint error from Postgres. They must stay in step with
 * `clinical_incident_reports`' own CHECK constraints — the DB is the boundary,
 * this is the early, legible refusal.
 */

export const incidentCategorySchema = z.enum(INCIDENT_CATEGORIES);

export const incidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);

/**
 * Statuses a reviewer may move a report INTO. 'open' is absent deliberately:
 * a report is created open by the trigger and can never be returned to open
 * (see nextStatusesFor in lib/clinical/incident-governance.ts for why the
 * database rejects it).
 */
export const incidentReviewStatusSchema = z.enum(["under_review", "action_planned", "closed"]);

/**
 * Filing a report. Anyone on the org staff may file — including a Care
 * Coordinator, whose noticing of a near miss is precisely the safety culture
 * this log exists to capture. Nothing about review state is accepted here;
 * the trigger forces reported_by/reported_at/status server-side regardless of
 * what a client sends.
 */
export const fileIncidentReportSchema = z.object({
  category: incidentCategorySchema,
  severity: incidentSeveritySchema,
  description: z
    .string()
    .trim()
    .min(20, "Describe what happened in a sentence or two — enough for someone else to review it")
    .max(4000),
  /** Optional: a report about a system failure may have no single patient. */
  patient_id: z.string().uuid().optional(),
  /** When it happened, if that differs from when it was noticed. */
  occurred_at: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date and time" })
    .optional(),
  immediate_action_taken: z.string().trim().max(2000).optional(),
  contributing_factors: z.string().trim().max(2000).optional(),
});
export type FileIncidentReportInput = z.infer<typeof fileIncidentReportSchema>;

/**
 * Adding detail to a report that is still open. Needs no clinical authority —
 * the trigger lets any org staff member add narrative as long as the status is
 * unchanged, which is what lets a Care Coordinator complete a report they
 * filed in a hurry.
 */
export const addIncidentDetailSchema = z.object({
  incident_id: z.string().uuid(),
  immediate_action_taken: z.string().trim().max(2000).optional(),
  contributing_factors: z.string().trim().max(2000).optional(),
});
export type AddIncidentDetailInput = z.infer<typeof addIncidentDetailSchema>;

/**
 * Moving a report through review (§31.8). Closing carries the extra burden the
 * table's CHECK constraint imposes: a closed report must say what was found
 * and what changed, so the outcome and corrective action are required — and
 * `superRefine` states that here rather than letting Postgres phrase it.
 */
export const reviewIncidentReportSchema = z
  .object({
    incident_id: z.string().uuid(),
    status: incidentReviewStatusSchema,
    review_outcome: z.string().trim().max(4000).optional(),
    corrective_action: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== "closed") return;
    if (!value.review_outcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review_outcome"],
        message: "Say what the review found before closing this report.",
      });
    }
    if (!value.corrective_action) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["corrective_action"],
        message: "Record the corrective action — or state explicitly that no action was needed.",
      });
    }
  });
export type ReviewIncidentReportInput = z.infer<typeof reviewIncidentReportSchema>;
