import { createClient } from "@/lib/supabase/server";
import { FastingSafetyConfigView } from "../fasting-safety-config/fasting-safety-config-view";

/**
 * The religious-fasting safety rules (S50b) sign-off panel: loads the newest version (the signed one if there is one, otherwise the unsigned draft,
 * because this config is born inactive) and renders the real view with the Sign control. Shared by the CMO's own page and the sign-off hub.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function FastingSafetyConfigPanel() {
  const { data, error } = await (await createClient())
    .from("fasting_safety_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The fasting safety rules could not be loaded. Please refresh.
    </p>
  ) : (
    <FastingSafetyConfigView row={data} canSign />
  );
}
