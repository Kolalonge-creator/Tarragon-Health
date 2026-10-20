import { createClient } from "@/lib/supabase/server";
import { ObservationLimitsView } from "../observation-limits/observation-limits-view";

/**
 * The plausibility limits sign-off panel (S47a): loads the newest version and renders the real view with the Sign control. Shared by the CMO's own
 * page and the sign-off hub, which opens it inline so a signature is given while looking at the numbers. Access is gated by the page that renders it.
 */
export async function ObservationLimitsPanel() {
  const { data, error } = await (await createClient())
    .from("observation_limit_signoffs")
    .select("id, version, approved_at, created_at, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      The limits could not be loaded. Please refresh.
    </p>
  ) : (
    <ObservationLimitsView row={data} canSign />
  );
}
