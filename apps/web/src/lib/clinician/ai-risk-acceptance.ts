import { z } from "zod";

/** W-10: what the CMO page reads and signs. The signature is the Chief Medical Officer's own; nothing here can sign on anyone's behalf. */
export const AI_RISK_SYSTEM_CODE = "AI-001";
/**
 * The ONE cap. It mirrors private.ai_acceptance_max_days() in the migration (the table check and the signing function use that function),
 * and a test reads the migration to keep the two equal. With no re-evaluation re-run yet the cap is the shorter NO_RERUN figure.
 */
export const MAX_ACCEPTANCE_DAYS = 90;
export const MAX_ACCEPTANCE_DAYS_NO_RERUN = 30;

export const restrictionStatusSchema = z.object({
  system_code: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  restricted_mode: z.enum(["none", "advisory_only"]),
  restricted_since: z.string().nullable(),
  restriction_reason: z.string().nullable(),
  reevaluation_due: z.string().nullable(),
  restriction_resets: z.number(),
  disabled_reason: z.string().nullable(),
  switch_off_on: z.string().nullable(),
  days_until_switch_off: z.number().nullable(),
  latest_evaluation_completed_at: z.string().nullable(),
  reevaluation_overdue: z.boolean(),
  can_sign: z.boolean(),
  max_acceptance_days: z.number(),
  no_rerun_acceptance_days: z.number(),
  acceptance: z
    .object({
      accepted_at: z.string(),
      valid_until: z.string(),
      summary: z.string(),
      evaluation_run_id: z.string().nullable(),
      no_rerun_yet: z.boolean(),
    })
    .nullable(),
});
export type RestrictionStatus = z.infer<typeof restrictionStatusSchema>;

export const signAcceptanceSchema = z
  .object({
    summary: z.string().trim().min(20, "summary_short").max(1000),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date_missing"),
    evaluationRunId: z.string().uuid().nullable(),
    noRerunYet: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.evaluationRunId !== null) === v.noRerunYet) ctx.addIssue({ code: "custom", message: "rerun_link", path: ["evaluationRunId"] });
  });

/** Whole days from `now` to a date (negative once passed). Null when there is no date. */
export function daysUntil(isoDate: string | null, now: Date): number | null {
  if (!isoDate) return null;
  const end = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / 86_400_000);
}

/** The latest end date for an acceptance today, depending on whether a re-evaluation has been re-run. */
export function maxValidUntil(now: Date, hasRerun: boolean): string {
  const days = hasRerun ? MAX_ACCEPTANCE_DAYS : MAX_ACCEPTANCE_DAYS_NO_RERUN;
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The reason the database gave, in plain words, so the form says what is actually wrong. */
export function explainSignError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("acceptance_too_long_without_rerun"))
    return `With no re-evaluation re-run yet, an acceptance can last at most ${MAX_ACCEPTANCE_DAYS_NO_RERUN} days.`;
  if (m.includes("acceptance_too_long")) return `An acceptance can last at most ${MAX_ACCEPTANCE_DAYS} days.`;
  if (m.includes("acceptance_date_not_future")) return "The end date must be after today.";
  if (m.includes("acceptance_needs_rerun_link")) return "Choose a re-evaluation run, or say that none has been re-run yet.";
  if (m.includes("acceptance_run_not_found")) return "That is not a completed evaluation run for this system.";
  if (m.includes("only the Chief Medical Officer")) return "Only the Chief Medical Officer can sign this.";
  return "That could not be signed. Please check the details and try again.";
}
