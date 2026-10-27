import { z } from "zod";

/** W-10: what the CMO page reads and signs. The signature is the Chief Medical Officer's own; nothing here can sign on anyone's behalf. */
export const AI_RISK_SYSTEM_CODE = "AI-001";
export const MAX_ACCEPTANCE_DAYS = 90;

export const restrictionStatusSchema = z.object({
  system_code: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  restricted_mode: z.enum(["none", "advisory_only"]),
  restricted_since: z.string().nullable(),
  restriction_reason: z.string().nullable(),
  reevaluation_due: z.string().nullable(),
  disabled_reason: z.string().nullable(),
  acceptance: z.object({ accepted_at: z.string(), valid_until: z.string(), summary: z.string() }).nullable(),
});
export type RestrictionStatus = z.infer<typeof restrictionStatusSchema>;

export const signAcceptanceSchema = z.object({
  summary: z.string().trim().min(20).max(1000),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Whole days from `now` to the dated switch-off (negative once passed). Null when there is no date. */
export function daysUntil(isoDate: string | null, now: Date): number | null {
  if (!isoDate) return null;
  const end = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / 86_400_000);
}

/** The latest date a CMO can accept to: a bounded window, so the acceptance is re-looked-at. */
export function maxValidUntil(now: Date): string {
  return new Date(now.getTime() + MAX_ACCEPTANCE_DAYS * 86_400_000).toISOString().slice(0, 10);
}
