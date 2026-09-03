import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { aiGovernanceDashboardSchema } from "./dashboard-schema";
import {
  AiGovernanceConsole,
  type AiIncidentRow,
  type AiModelObservationRow,
  type AiPromptVersionRow,
  type AiSystemRow,
} from "./ai-governance-console";

/**
 * AI governance console — Module 40.13's clinical-governance view, plus the
 * controls behind it: the kill switch (40.17), incident triage and closure
 * (40.12), governed prompt activation (40.6), and the 40.20 acceptance
 * criteria still outstanding on each registered system.
 *
 * The page deliberately opens on what is NOT yet true. Ten AI capabilities
 * were running in production before any of this existed; the honest first
 * screen is the list of what each of them still owes, not a wall of green
 * ticks. See the part-6 registration migration for why they are recorded as
 * live-and-grandfathered rather than switched off or quietly omitted.
 *
 * Auth is gated the same delegable-permission way every other admin surface
 * is (`ai_governance.manage`, added to `PERMISSION_KEYS` in
 * `@/lib/auth/permissions`) rather than a bare `role === "admin"` check — a
 * super admin can delegate this without granting the full admin role, same
 * as partners/orgs/roles management. The RPC/RLS layer enforces its own
 * stricter admin-or-Clinical-Director check regardless; this is only the
 * page guard.
 */
export default async function AiGovernancePage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  if (!profile || (!isSuperAdmin && !keys.has("ai_governance.manage"))) {
    redirect("/admin");
  }

  const supabase = await createClient();

  const [{ data: dashboardData, error: dashboardError }, incidentsResult, promptsResult, observationsResult] =
    await Promise.all([
      supabase.rpc("ai_governance_dashboard", { p_days: 30 }),
      supabase
        .from("ai_safety_incidents")
        .select(
          "id, ai_system_id, interaction_id, reporter_kind, category, severity, status, description, clinical_review_summary, corrective_action, patient_harm_occurred, created_at, resolved_at"
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("ai_prompt_versions")
        .select("id, ai_system_id, version, is_active, approved_at, change_summary, created_at")
        .order("version", { ascending: false }),
      supabase
        .from("ai_vendor_model_observations")
        .select(
          "id, ai_system_id, observed_model_identifier, expected_model_identifier, is_expected, first_seen_at, last_seen_at, observation_count, acknowledged_at"
        )
        .eq("is_expected", false)
        .order("last_seen_at", { ascending: false })
        .limit(25),
    ]);

  const parsed = aiGovernanceDashboardSchema.safeParse(dashboardData);

  if (dashboardError || !parsed.success) {
    // Deliberately a visible failure rather than empty tiles. A blank AI
    // governance page reads as "nothing to worry about", which is the one
    // wrong message it could send.
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">AI governance</h1>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          The governance dashboard could not be loaded, so nothing on this page can be trusted as
          current. {dashboardError?.message ?? parsed.error?.message}
        </p>
      </div>
    );
  }

  // ai_systems is a small, non-PHI registry table readable by any signed-in
  // account, so this join happens here rather than inside the dashboard RPC's
  // per-system subselects.
  const { data: systemRows } = await supabase
    .from("ai_systems")
    .select(
      "id, system_code, name, purpose, owner_role, owner_profile_id, fallback_behaviour, code_reference, disabled_reason, disabled_at, runtime_governed, grandfather_note"
    )
    .order("system_code");

  return (
    <AiGovernanceConsole
      dashboard={parsed.data}
      systems={(systemRows ?? []) as AiSystemRow[]}
      incidents={(incidentsResult.data ?? []) as AiIncidentRow[]}
      promptVersions={(promptsResult.data ?? []) as AiPromptVersionRow[]}
      modelObservations={(observationsResult.data ?? []) as AiModelObservationRow[]}
    />
  );
}
