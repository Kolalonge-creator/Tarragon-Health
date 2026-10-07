import { z } from "zod";

/**
 * S36d: the clinician roster (spec 9.4) and the role-grants history, over the S15 tables and the S36d functions
 * (supabase/migrations/*_s36d_clinician_roster_and_grants_history.sql). Every answer is parsed here; the database decides who may
 * read or write, so nothing on a page grants anything.
 */
export const pendingRequestSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["competency_grant", "reinstatement"]),
  competency_code: z.string().nullable(),
  reason: z.string(),
  requested_at: z.string(),
  requested_by_name: z.string().nullable(),
  requested_by_me: z.boolean(),
});
export type PendingRequest = z.infer<typeof pendingRequestSchema>;

export const rosterRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  doctor_tier: z.string().nullable(),
  employment_type: z.string().nullable(),
  status: z.enum(["active", "suspended", "offboarded"]),
  active: z.boolean(),
  level: z.number().int().nullable(),
  suspended_at: z.string().nullable(),
  suspended_reason: z.string().nullable(),
  license_expires_at: z.string().nullable(),
  indemnity_expires_at: z.string().nullable(),
  indemnity_required: z.boolean(),
  eligible: z.boolean(),
  is_self: z.boolean(),
  competencies: z.array(z.string()),
  pending_requests: z.array(pendingRequestSchema),
});
export type RosterRow = z.infer<typeof rosterRowSchema>;
export const rosterSchema = z.array(rosterRowSchema);

export const competencyRowsSchema = z.array(z.object({ code: z.string(), label: z.string(), requires_level: z.number().int(), is_active: z.boolean() }));
export type CompetencyRow = z.infer<typeof competencyRowsSchema>[number];

export const currentGrantSchema = z.object({
  permission_key: z.string(),
  permission_label: z.string().nullable(),
  source: z.string(),
  holder_id: z.string().uuid(),
  holder_name: z.string().nullable(),
  holder_role: z.string().nullable(),
  holder_active: z.boolean().nullable(),
  granted_at: z.string().nullable(),
  granted_by_name: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export const historyRowSchema = z.object({
  id: z.string().uuid(),
  permission_key: z.string(),
  holder_id: z.string().uuid(),
  holder_name: z.string().nullable(),
  granted_at: z.string(),
  granted_by_name: z.string().nullable(),
  revoked_at: z.string().nullable(),
  revoked_by_name: z.string().nullable(),
});
export const auditRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  created_at: z.string(),
  actor_name: z.string().nullable(),
  subject_name: z.string().nullable(),
  permission_key: z.string().nullable(),
});
export const grantsHistorySchema = z.object({
  current: z.array(currentGrantSchema),
  history: z.array(historyRowSchema),
  audit: z.array(auditRowSchema),
});
export type GrantsHistory = z.infer<typeof grantsHistorySchema>;

export const NOTICES = [
  "suspended", "suspend_failed", "requested", "request_failed", "decided", "decide_failed",
  "granted", "grant_failed", "revoked", "revoke_failed", "reinstated", "reinstate_failed",
] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);
export const isFailure = (n: Notice): boolean => n.endsWith("failed");

/** Roster order: people needing attention first (suspended, then cannot take work), then by name. */
export function sortRoster(rows: RosterRow[]): RosterRow[] {
  const rank = (r: RosterRow) => (r.pending_requests.length > 0 ? 0 : r.status === "suspended" ? 1 : !r.eligible ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

/** Competencies a request or grant form may offer: active ones the clinician does not already hold. */
export function grantableCompetencies(all: CompetencyRow[], row: Pick<RosterRow, "competencies">): CompetencyRow[] {
  return all.filter((c) => c.is_active && !row.competencies.includes(c.code));
}
