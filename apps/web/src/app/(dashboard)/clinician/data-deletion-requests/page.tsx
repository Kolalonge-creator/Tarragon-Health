import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { DataDeletionRequestsDashboard } from "./data-deletion-requests-dashboard";

/**
 * 55.19 device/wearable data governance — org staff processing queue. Lists
 * data_deletion_requests for the caller's org (RLS already scopes reads to
 * private.is_org_staff) and lets staff either process a request via the
 * bounded, audited execute_wearable_data_deletion() RPC or reject it with a
 * plain-text reason. Mirrors device-operations/page.tsx's server-resolves-
 * organisationId, client-renders-the-worklist split.
 */
export default async function DataDeletionRequestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.organisation_id || profile.role === "patient") {
    redirect("/clinician");
  }

  return <DataDeletionRequestsDashboard organisationId={profile.organisation_id} />;
}
