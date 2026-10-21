import { createClient } from "@/lib/supabase/server";
import { readCuffGuidance } from "@/lib/home-bp/read-cuff-guidance";
import { CuffGuidanceView } from "../cuff-guidance/cuff-guidance-view";

/** The cuff size guidance sign-off panel: loads its own data and renders the real view, values and Sign control together. Shared by the CMO's own page and the sign-off hub. */
export async function CuffGuidancePanel() {
  const { live, pending, loadFailed } = await readCuffGuidance(await createClient());
  return loadFailed ? (
    <p role="alert" className="text-sm text-red-700">
      The cuff size guidance could not be loaded. Please refresh.
    </p>
  ) : (
    <CuffGuidanceView live={live} pending={pending} canSign />
  );
}
