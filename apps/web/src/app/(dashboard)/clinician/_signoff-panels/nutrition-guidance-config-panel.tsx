import { createClient } from "@/lib/supabase/server";
import { NutritionGuidanceConfigView } from "../nutrition-guidance-config/nutrition-guidance-config-view";

/**
 * The eating plans and swaps sign-off panel (S50a): loads the newest version (the live one if there is one, otherwise the unsigned draft) and
 * renders the real view with the Sign control. Shared by the CMO's own page and the sign-off hub. Access is gated by the page that renders it
 * (both require canAssignCases).
 */
export async function NutritionGuidanceConfigPanel() {
  const { data, error } = await (await createClient())
    .from("nutrition_guidance_config")
    .select("id, version, is_active, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The eating plans configuration could not be loaded. Please refresh.
    </p>
  ) : (
    <NutritionGuidanceConfigView row={data} canSign />
  );
}
