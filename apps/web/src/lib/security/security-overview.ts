import { z } from "zod";

/**
 * Read side of /admin/security (security audit 2026-11-05, Phase 3). One admin-only database function,
 * `security_overview()`, built only from signals the platform records: failed and successful sign-ins, the open security
 * alerts, staff MFA and dormancy, privileged changes, exports and the staff access review. A refusal is shown as an error,
 * never as an empty dashboard.
 */
interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const count = z.coerce.number().int().nonnegative();
const reviewStatusSchema = z.object({
  last_completed_at: z.string().nullable(),
  next_due_at: z.string(),
  overdue: z.boolean(),
  open_review_id: z.string().uuid().nullable(),
  interval_days: count,
});

export const securityOverviewSchema = z.object({
  generated_at: z.string(),
  failed_sign_ins: z.object({ last_24h: count, last_7d: count, accounts_7d: count }),
  sign_ins_7d: count,
  open_security_alerts: z.array(
    z.object({ rule: z.string(), severity: z.string(), first_seen_at: z.string(), detail: z.record(z.string(), z.unknown()) })
  ),
  staff: z.object({ total: count, active: count, mfa_enrolled: count, dormant: count, dormant_after_days: count }),
  privileged_changes_30d: z.array(z.object({ at: z.string(), change: z.string(), by: z.string() })),
  exports_30d: z.array(z.object({ at: z.string(), export: z.string(), by: z.string() })),
  staff_access_review: reviewStatusSchema,
});
export type SecurityOverview = z.infer<typeof securityOverviewSchema>;
export type StaffAccessReviewStatus = z.infer<typeof reviewStatusSchema>;

export type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

export async function loadSecurityOverview(client: unknown): Promise<Loaded<SecurityOverview>> {
  const { data, error } = await (client as Rpc).rpc("security_overview");
  if (error) return { ok: false, message: "The security overview could not be loaded." };
  const parsed = securityOverviewSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: "The security overview came back in a shape this page does not understand." };
  return { ok: true, value: parsed.data };
}

/** Plain names for the four security alert rules. */
export const SECURITY_RULE_LABELS: Record<string, string> = {
  failed_sign_in_spike: "Sign-in failures are unusually high",
  staff_bulk_record_access: "A staff member opened an unusual number of patient records",
  privileged_change: "An account role or clinician authority changed",
  patient_data_export: "Patient-level data was exported",
};

export const EXPORT_LABELS: Record<string, string> = {
  "admin.patient_directory_exported": "Patient directory",
  "consultations.log_export": "Consultations log",
  "research_export.created": "Research export",
};
