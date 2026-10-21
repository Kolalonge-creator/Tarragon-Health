import { createClient } from "@/lib/supabase/server";
import { NutritionTargetsConfigView } from "../nutrition-targets-config/nutrition-targets-config-view";

/**
 * The nutrition targets and meal summary sign-off panel (S49a): loads the newest version (the live one if there is one, otherwise the unsigned
 * draft) and renders the real view with the Sign control. Shared by the CMO's own page and the sign-off hub, which opens it inline so a
 * signature is given while looking at the numbers. Access is gated by the page that renders it (both require canAssignCases).
 */
export async function NutritionTargetsConfigPanel() {
  const { data, error } = await (await createClient())
    .from("nutrition_target_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The nutrition targets configuration could not be loaded. Please refresh.
    </p>
  ) : (
    <NutritionTargetsConfigView row={data} canSign />
  );
}
