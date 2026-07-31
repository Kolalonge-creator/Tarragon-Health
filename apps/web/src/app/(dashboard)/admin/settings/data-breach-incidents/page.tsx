import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DataBreachIncidentsManager, type DataBreachIncidentRow } from "./data-breach-incidents-manager";

/**
 * Operationalizes docs/legal/breach-notification-runbook.md — the NDPA gives
 * a 72-hour window from the moment TarragonHealth becomes aware of a
 * personal data breach to notify the NDPC. This is where that clock is
 * actually tracked, not just described in a document nobody can act on.
 * Deliberately admin-only, not delegated via the RBAC permission system —
 * this record's own contents (who knew what, and when) are too sensitive
 * for casual broadening.
 */
export default async function DataBreachIncidentsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: incidents } = await supabase
    .from("data_breach_incidents")
    .select("*")
    .order("discovered_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Data breach incidents
        </h1>
        <p className="text-charcoal-ink/60">
          Log any confirmed or reasonably suspected personal data breach here the moment
          TarragonHealth becomes aware of it — that starts the Nigeria Data Protection Act&apos;s
          72-hour NDPC-notification clock. See{" "}
          <code>docs/legal/breach-notification-runbook.md</code> for the full procedure.
        </p>
      </div>
      <DataBreachIncidentsManager initialIncidents={(incidents ?? []) as DataBreachIncidentRow[]} />
    </div>
  );
}
