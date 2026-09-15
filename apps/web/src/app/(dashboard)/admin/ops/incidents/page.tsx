import { redirect } from "next/navigation";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { IncidentsManager, type OpsIncidentRow } from "./incidents-manager";

/**
 * Module 30.18 — the unified operations incident register. Sits above
 * clinical_incident_reports and data_breach_incidents (see the migration
 * comment on public.ops_incidents) rather than replacing either: this is
 * where a Paystack outage, a leaked service key, or a mis-settled partner
 * payout gets logged, tracked against an SLA, and closed with a stated root
 * cause — the six categories the operations spec names, in one place.
 */
export default async function OpsIncidentsPage() {
  const profile = await getCurrentProfile();
  const canView =
    profile?.role === "admin" || (await hasAnyPermission("incidents.view", "incidents.manage"));
  if (!canView) {
    redirect("/admin");
  }
  const canManage =
    profile?.role === "admin" || (await hasAnyPermission("incidents.manage"));

  const supabase = await createClient();
  const { data: incidents, error: incidentsError } = await supabase
    .from("ops_incidents")
    .select(
      "id, reference, category, severity, status, title, summary, detected_at, ack_due_at, resolve_due_at, acknowledged_at, resolved_at, closed_at, owner_id, requires_regulatory_notification"
    )
    .order("detected_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident register"
        description={
          <>
            Clinical, technical, privacy, security, financial and operational incidents, each
            against a severity-based SLA. A confirmed personal-data breach should still be logged in
            its own governed NDPR record (<code>/admin/settings/data-breach-incidents</code>). Link
            it here from the incident detail page so operations has one place to see everything in
            flight.
          </>
        }
      />
      {/* "No incidents logged. That's the goal." is a congratulation, and a
          failed read used to earn it. Every incident here is tracked against a
          severity-based SLA, so an unread register is also an unread clock. */}
      <IncidentsManager
        initialIncidents={(incidents ?? []) as OpsIncidentRow[]}
        canManage={canManage}
        loadFailed={incidentsError !== null}
      />
    </div>
  );
}
