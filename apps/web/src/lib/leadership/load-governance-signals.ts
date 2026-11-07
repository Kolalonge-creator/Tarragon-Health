import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplaintRow, Database, IncidentRow, SafeguardingRow } from "@tarragon/shared";
import { excludeTestPatients } from "@/lib/queries/real-patients";

/**
 * Open governance records for the CMO's overview and the governance index (CMO command centre, 2026-11-07).
 *
 * Reads the authoritative tables directly, under the caller's RLS (never the service role): clinical_incident_reports,
 * safeguarding_concerns and complaints. Only open records, only the columns an executive summary needs; free-text
 * descriptions are never selected, so a safeguarding or incident narrative cannot reach the overview by accident.
 * Each list is `null` when its read failed, so the page says "could not be loaded" instead of showing an all-clear.
 * Test patients are excluded (INV-13).
 */
export type GovernanceSignals = {
  incidents: IncidentRow[] | null;
  safeguarding: SafeguardingRow[] | null;
  complaints: ComplaintRow[] | null;
  /** The exact number open (a separate count, so it stays right when a list is longer than LIMIT). Null when the read failed. */
  totals: { incidents: number | null; safeguarding: number | null; complaints: number | null };
};

/** Rows drawn per list for the executive panel (oldest first); `totals` always carries the exact open count. */
export const GOVERNANCE_SIGNAL_LIMIT = 200;
const LIMIT = GOVERNANCE_SIGNAL_LIMIT;

type Named = { full_name: string | null } | null;

export async function loadGovernanceSignals(
  supabase: SupabaseClient<Database>,
  testPatientIds: readonly string[]
): Promise<GovernanceSignals> {
  const [incidentsRes, safeguardingRes, complaintsRes] = await Promise.all([
    excludeTestPatients(
      supabase
        .from("clinical_incident_reports")
        .select("id, category, severity, status, reported_at, reviewer:clinical_staff!clinical_incident_reports_reviewed_by_staff_fkey(full_name)", { count: "exact" })
        .neq("status", "closed")
        .order("reported_at", { ascending: true })
        .limit(LIMIT),
      testPatientIds,
      { nullable: true }
    ).returns<{ id: string; category: string; severity: string; status: string; reported_at: string; reviewer: Named }[]>(),
    excludeTestPatients(
      supabase
        .from("safeguarding_concerns")
        .select("id, concern_category, status, reported_at, reviewer:clinical_staff!safeguarding_concerns_reviewed_by_staff_fkey(full_name)", { count: "exact" })
        .neq("status", "closed")
        .order("reported_at", { ascending: true })
        .limit(LIMIT),
      testPatientIds
    ).returns<{ id: string; concern_category: string; status: string; reported_at: string; reviewer: Named }[]>(),
    excludeTestPatients(
      supabase
        .from("complaints")
        .select("id, category, status, created_at, assignee:profiles!complaints_assigned_to_fkey(full_name)", { count: "exact" })
        .neq("status", "governance_review")
        .order("created_at", { ascending: true })
        .limit(LIMIT),
      testPatientIds
    ).returns<{ id: string; category: string; status: string; created_at: string; assignee: Named }[]>(),
  ]);

  const total = (r: { error: unknown; count: number | null; data: unknown[] | null }) =>
    r.error ? null : (r.count ?? r.data?.length ?? 0);
  return {
    totals: { incidents: total(incidentsRes), safeguarding: total(safeguardingRes), complaints: total(complaintsRes) },
    incidents: incidentsRes.error
      ? null
      : (incidentsRes.data ?? []).map((r) => ({
          id: r.id,
          category: r.category,
          severity: r.severity,
          status: r.status,
          reported_at: r.reported_at,
          reviewer_name: r.reviewer?.full_name ?? null,
        })),
    safeguarding: safeguardingRes.error
      ? null
      : (safeguardingRes.data ?? []).map((r) => ({
          id: r.id,
          concern_category: r.concern_category,
          status: r.status,
          reported_at: r.reported_at,
          reviewer_name: r.reviewer?.full_name ?? null,
        })),
    complaints: complaintsRes.error
      ? null
      : (complaintsRes.data ?? []).map((r) => ({
          id: r.id,
          category: r.category,
          status: r.status,
          created_at: r.created_at,
          assignee_name: r.assignee?.full_name ?? null,
        })),
  };
}
