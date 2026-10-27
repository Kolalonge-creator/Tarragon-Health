import { createClient } from "@/lib/supabase/server";
import { HomeCardConfigView } from "../home-card-config/home-card-config-view";

/**
 * The Today screen cards, weekly summary and readiness sign-off panel (S47b): loads the newest version (the live one if there is one, otherwise the
 * unsigned draft) and renders the real view with the Sign control. Shared by the CMO's own page and the sign-off hub.
 */
export async function HomeCardConfigPanel() {
  const { data, error } = await (await createClient())
    .from("home_card_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The Today screen configuration could not be loaded. Please refresh.
    </p>
  ) : (
    <HomeCardConfigView row={data} canSign />
  );
}
