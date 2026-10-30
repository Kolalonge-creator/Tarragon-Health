import { createClient } from "@/lib/supabase/server";
import { LowCarbProtocolConfigView } from "../lowcarb-protocol-config/lowcarb-protocol-config-view";

/**
 * The low-carbohydrate programme rules (S50b) sign-off panel: loads the newest version (the live one if there is one, otherwise the unsigned draft)
 * and renders the real view with the Sign control. Shared by the CMO's own page and the sign-off hub. Access is gated by the page that renders it
 * (both require canAssignCases).
 */
export async function LowCarbProtocolConfigPanel() {
  const { data, error } = await (await createClient())
    .from("lowcarb_protocol_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The low-carbohydrate programme rules could not be loaded. Please refresh.
    </p>
  ) : (
    <LowCarbProtocolConfigView row={data} canSign />
  );
}
