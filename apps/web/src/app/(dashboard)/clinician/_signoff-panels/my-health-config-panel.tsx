import { createClient } from "@/lib/supabase/server";
import { MyHealthConfigView } from "../my-health-config/my-health-config-view";

/**
 * The My Health lock-screen pass field list (C8) sign-off panel: loads the active row and renders the real view with the Sign control. Shared by
 * the CMO's own page and the sign-off hub, which opens it inline so a signature is given while looking at the list. Access is gated by the page
 * that renders it (both require canAssignCases).
 */
export async function MyHealthConfigPanel() {
  const { data, error } = await (await createClient())
    .from("my_health_config")
    .select("id, version, approved_at, created_at, config")
    .eq("is_active", true)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The My Health configuration could not be loaded. Please refresh.
    </p>
  ) : (
    <MyHealthConfigView row={data} canSign />
  );
}
