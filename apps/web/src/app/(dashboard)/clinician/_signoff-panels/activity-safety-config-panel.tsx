import { createClient } from "@/lib/supabase/server";
import { ActivitySafetyConfigView } from "../activity-safety-config/activity-safety-config-view";

/**
 * The activity safety rules (S48a) sign-off panel: loads the active row and renders the real view with the Sign control. Shared by the CMO's own
 * page and the sign-off hub, which opens it inline so a signature is given while looking at the rules. Access is gated by the page that renders
 * it (both require canAssignCases).
 */
export async function ActivitySafetyConfigPanel() {
  const { data, error } = await (await createClient())
    .from("activity_safety_config")
    .select("id, version, approved_at, created_at, config")
    .eq("is_active", true)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The activity safety rules could not be loaded. Please refresh.
    </p>
  ) : (
    <ActivitySafetyConfigView row={data} canSign />
  );
}
