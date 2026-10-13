import { createClient } from "@/lib/supabase/server";
import { readHomeBpProgramme } from "@/lib/home-bp/read-home-bp-programme";
import { HomeBpProgrammeView } from "../home-bp-programme/home-bp-programme-view";

/**
 * The home blood pressure programme sign-off panel: loads its own data and renders the real view, values and Sign control together.
 * Shared by the CMO's own page and by the sign-off hub, which opens it inline so a signature is given while looking at the actual numbers.
 */
export async function HomeBpProgrammePanel() {
  const { live, pending, loadFailed } = await readHomeBpProgramme(await createClient());
  return loadFailed ? (
    <p role="alert" className="text-sm text-red-700">
      The home blood pressure programme could not be loaded. Please refresh.
    </p>
  ) : (
    <HomeBpProgrammeView live={live} pending={pending} canSign />
  );
}
