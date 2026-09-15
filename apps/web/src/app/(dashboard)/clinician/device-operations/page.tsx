import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { DeviceOperationsDashboard } from "./device-operations-dashboard";

/**
 * 55.10/55.11/55.16/55.17 device & data operations dashboard — org clinical/
 * ops staff only. Answers the 55.20 acceptance questions this feature set
 * exists for: which patient has which device/connection, is it working, are
 * measurements arriving, and (via the Integration Health panel) did the
 * clinical team receive the relevant signal when a pipeline went down.
 *
 * "Device fleet" here means the fleet of CONNECTIONS (wearable_connections +
 * patient_devices), not Tarragon-owned hardware — see CLAUDE.md's 2026-08-02
 * founder decision. There is no inventory/procurement/logistics view because
 * there is no owned inventory to track.
 */
export default async function DeviceOperationsPage() {
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

  return <DeviceOperationsDashboard organisationId={profile.organisation_id} />;
}
