import { z } from "zod";

/**
 * The shape `public.ai_governance_dashboard()` returns (Module 40.13).
 * Parsed rather than cast: this page is the one place a Clinical Director
 * looks to decide whether an AI system should keep running, so a payload
 * that has drifted from what the page expects must be a visible error, not a
 * silently blank tile that reads as "nothing to worry about".
 */

/**
 * One required-for-release evaluation suite and the outcome of its most
 * recent run. `latest_outcome` is null when the suite has never been run
 * against this system — deliberately distinct from "ran and failed", because
 * "nobody has checked" and "we checked and it is wrong" are different
 * problems and the first must not hide the second.
 */
export const aiRequiredEvaluationSchema = z.object({
  suite_id: z.string(),
  name: z.string(),
  kind: z.string(),
  scope: z.enum(["system", "platform"]),
  pass_threshold_pct: z.coerce.number().nullable(),
  latest_outcome: z.enum(["pass", "fail", "needs_review"]).nullable(),
  latest_run_at: z.string().nullable(),
  latest_pass_rate_pct: z.coerce.number().nullable(),
  latest_run_reviewed: z.boolean(),
});

export type AiRequiredEvaluation = z.infer<typeof aiRequiredEvaluationSchema>;

export const aiAcceptanceSchema = z.object({
  system_id: z.string(),
  system_code: z.string(),
  criteria: z.object({
    purpose: z.boolean(),
    owner: z.boolean(),
    risk_classification: z.boolean(),
    validation: z.boolean(),
    guardrails: z.boolean(),
    monitoring: z.boolean(),
    evaluation_passing: z.boolean(),
    audit: z.boolean(),
    rollback: z.boolean(),
  }),
  satisfied: z.boolean(),
  outstanding: z.array(z.string()),
  evaluations: z.array(aiRequiredEvaluationSchema),
  owner_assigned: z.boolean(),
  grandfathered: z.boolean(),
});

export type AiAcceptance = z.infer<typeof aiAcceptanceSchema>;

export const aiDashboardSystemSchema = z.object({
  system_code: z.string(),
  name: z.string(),
  risk_class: z.string(),
  autonomy_level: z.string(),
  lifecycle_status: z.string(),
  is_enabled: z.boolean(),
  grandfathered: z.boolean(),
  next_review_due: z.string().nullable(),
  approved_version: z.string().nullable(),
  active_prompt_version: z.number().nullable(),
  interactions: z.number(),
  human_overrides: z.number(),
  incidents: z.number(),
  acceptance: aiAcceptanceSchema,
});

export type AiDashboardSystem = z.infer<typeof aiDashboardSystemSchema>;

export const aiGovernanceDashboardSchema = z.object({
  window_days: z.number(),
  since: z.string(),
  scope: z.enum(["platform", "organisation"]),
  totals: z.object({
    interactions: z.number(),
    escalations: z.number(),
    human_overrides: z.number(),
    high_risk_outputs: z.number(),
    flagged_for_review: z.number(),
    blocked_by_guardrail: z.number(),
    fallbacks: z.number(),
    failures: z.number(),
  }),
  incidents: z.object({
    total: z.number(),
    open: z.number(),
    critical_open: z.number(),
    with_patient_harm: z.number(),
  }),
  monitoring: z.object({
    unacknowledged_model_changes: z.number(),
    drift_breaches: z.number(),
    material_disparities: z.number(),
    systems_overdue_review: z.number(),
    systems_live_with_failing_evaluations: z.number(),
    systems_live_with_unrun_evaluations: z.number(),
  }),
  systems: z.array(aiDashboardSystemSchema),
});

export type AiGovernanceDashboard = z.infer<typeof aiGovernanceDashboardSchema>;

/** Human-readable names for the 40.20 acceptance criteria. */
export const ACCEPTANCE_CRITERION_LABEL: Record<keyof AiAcceptance["criteria"], string> = {
  purpose: "Purpose",
  owner: "Owner",
  risk_classification: "Risk classification",
  validation: "Validation",
  guardrails: "Guardrails",
  monitoring: "Monitoring",
  evaluation_passing: "Evaluations passing",
  audit: "Audit",
  rollback: "Rollback",
};

export const RISK_LABEL: Record<string, string> = {
  low: "Low impact",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

export const AUTONOMY_LABEL: Record<string, string> = {
  inform_only: "Inform only",
  recommend: "Recommend: a human decides",
  assist: "Assist: performs part of a workflow",
  execute: "Execute: acts automatically",
};

/** Higher risk reads redder, matching the clinical status palette. */
export const RISK_BADGE_VARIANT: Record<string, "red" | "amber" | "blue" | "grey" | "green"> = {
  low: "grey",
  moderate: "blue",
  high: "amber",
  very_high: "red",
};
