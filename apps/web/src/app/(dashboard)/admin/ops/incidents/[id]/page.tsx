import { redirect, notFound } from "next/navigation";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { IncidentDetail, type OpsIncidentDetailRow, type OpsIncidentUpdateRow } from "./incident-detail";

export default async function OpsIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const canView =
    profile?.role === "admin" || (await hasAnyPermission("incidents.view", "incidents.manage"));
  if (!canView) {
    redirect("/admin");
  }
  const canManage = profile?.role === "admin" || (await hasAnyPermission("incidents.manage"));

  const supabase = await createClient();
  const [{ data: incident }, { data: updates }] = await Promise.all([
    supabase.from("ops_incidents").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ops_incident_updates")
      .select("id, note, status_from, status_to, created_at, author_id")
      .eq("incident_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!incident) {
    notFound();
  }

  return (
    <IncidentDetail
      incident={incident as OpsIncidentDetailRow}
      updates={(updates ?? []) as OpsIncidentUpdateRow[]}
      canManage={canManage}
    />
  );
}
